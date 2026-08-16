import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import type {
  DraftSnapshot,
  DraftTeamSnapshot,
  DraftUmaAction,
  PlayerRecentMatchSummary,
  PlayerStatsScope,
  PlayerProfileSummary,
  PlayerTopUmaSummary,
  PrematchPlayer,
  PrematchRoster,
  PrematchTeam,
  TeamId
} from '@umalytics/shared';
import {
  getPlayerProfileSummaries,
  PLAYER_PROFILE_SUMMARIES_STORAGE_KEY,
  type PlayerProfileSummariesSnapshot
} from '../../utils/profileStorage';
import {
  getLatestDraftSnapshot,
  LATEST_DRAFT_SNAPSHOT_STORAGE_KEY
} from '../../utils/draftStorage';
import {
  getLatestPrematchRoster,
  LATEST_PREMATCH_ROSTER_STORAGE_KEY
} from '../../utils/rosterStorage';
import { sendLobbyReconnectRequest, sendProfileRefreshRequest } from '../../utils/messaging';
import {
  BEST_UMA_MIN_MATCHES,
  MANUAL_PROFILE_REFRESH_COOLDOWN_MS,
  RECENT_HISTORY_DISPLAY_MATCHES
} from '../../utils/profileConstants';
import { releaseOrder } from '../../utils/umaReleaseOrder';
import {
  getUmaDisplayName,
  getUmaPortraitUrl,
  isKnownUmaOutfitId,
  isHashedUmaAssetUrl,
  normalizeUmaOutfitId
} from '../../utils/umaPortraits';

const TEAM_IDS = ['team1', 'team2'] as const satisfies readonly TeamId[];
const TEAM_SLOT_COUNT = 5;
const DRAFT_MAP_SLOT_COUNT = 4;
const DRAFT_PICK_SLOT_COUNT = 6;
const DRAFT_BAN_SLOT_COUNT = 2;
const DRAFT_VETO_SLOT_COUNT = 1;
const DRAFT_PLAN_PIN_LIMIT = 12;
const DRAFT_DETAIL_SEPARATOR = ' \u2022 ';
const STATS_SCOPE_STORAGE_KEY = 'statsScope';
const ACTIVE_CLOCK_REFRESH_MS = 1_000;
const IDLE_CLOCK_REFRESH_MS = 15_000;

type AppScene = 'lobby' | 'draft' | 'umas';
type NotableBadgeTone = 'rank' | 'scoring' | 'sample' | 'private';
type UmaBadgeTone = 'scoring' | 'winrate' | 'sample' | 'caution';
type SampleConfidence = 'small' | 'steady' | 'proven';
type UmaCatalogSortMode = 'releaseOrder' | 'lobbyHits' | 'alphabetical';
type UmaCatalogHitScope = 'all' | TeamId;
type UmaCatalogSortOption = { value: UmaCatalogSortMode; label: string };
type UmaCatalogHitScopeOption = { value: UmaCatalogHitScope; label: string };

interface NotableBadge {
  label: string;
  tone: NotableBadgeTone;
  title: string;
}

interface UmaBadge {
  label: string;
  value: string;
  tone: UmaBadgeTone;
  title: string;
}

interface PartyVisual {
  className: 'party-accent-1' | 'party-accent-2';
  label: string;
  title: string;
}

interface SelectedPlayerContext {
  team: PrematchTeam;
  player: PrematchPlayer;
}

interface UmaExperienceEntry {
  discordId: string;
  displayName: string;
  uma: PlayerTopUmaSummary;
}

interface UmaCatalogOption {
  umaId: string;
  name: string;
  imageUrl: string | undefined;
  order: number | undefined;
}

const DEFAULT_UMA_CATALOG_SORT_OPTION: UmaCatalogSortOption = { value: 'lobbyHits', label: 'Total hits' };
const UMA_CATALOG_SORT_OPTIONS: UmaCatalogSortOption[] = [
  DEFAULT_UMA_CATALOG_SORT_OPTION,
  { value: 'releaseOrder', label: 'Release order' },
  { value: 'alphabetical', label: 'Alphabetical' }
];
const UMA_CATALOG_HIT_SCOPE_OPTIONS: UmaCatalogHitScopeOption[] = [
  { value: 'all', label: 'All' },
  { value: 'team1', label: 'Team 1' },
  { value: 'team2', label: 'Team 2' }
];
const RELEASE_VARIANT_BY_OUTFIT_ID = new Map(
  releaseOrder.map((entry) => [entry.outfitId, entry.variant.trim()] as const)
);

export default function App() {
  const [roster, setRoster] = useState<PrematchRoster | undefined>();
  const [draftSnapshot, setDraftSnapshot] = useState<DraftSnapshot | undefined>();
  const [profileSnapshot, setProfileSnapshot] = useState<PlayerProfileSummariesSnapshot | undefined>();
  const [statsScope, setStatsScope] = useState<PlayerStatsScope>('currentSeason');
  const [activeScene, setActiveScene] = useState<AppScene>('lobby');
  const [selectedPlayerKey, setSelectedPlayerKey] = useState<string | undefined>();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void getLatestPrematchRoster().then(setRoster);
    void getLatestDraftSnapshot().then(setDraftSnapshot);
    void getPlayerProfileSummaries().then(setProfileSnapshot);
    void getStoredStatsScope().then(setStatsScope);
    void sendLobbyReconnectRequest();

    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local') {
        return;
      }

      const rosterChange = changes[LATEST_PREMATCH_ROSTER_STORAGE_KEY];

      if (rosterChange !== undefined) {
        setRoster(isPrematchRoster(rosterChange.newValue) ? rosterChange.newValue : undefined);
      }

      const draftChange = changes[LATEST_DRAFT_SNAPSHOT_STORAGE_KEY];

      if (draftChange !== undefined) {
        setDraftSnapshot(isDraftSnapshot(draftChange.newValue) ? draftChange.newValue : undefined);
      }

      const profileChange = changes[PLAYER_PROFILE_SUMMARIES_STORAGE_KEY];

      if (profileChange !== undefined) {
        setProfileSnapshot(isProfileSnapshot(profileChange.newValue) ? profileChange.newValue : undefined);
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (roster === undefined) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setNow(Date.now());
    }, getClockRefreshDelayMs(profileSnapshot, now));

    return () => {
      window.clearTimeout(timer);
    };
  }, [now, profileSnapshot, roster]);

  const teamGroups = useMemo(() => getTeamGroups(roster), [roster]);
  const selectedPlayerContext = useMemo(
    () => getSelectedPlayerContext(teamGroups, selectedPlayerKey),
    [teamGroups, selectedPlayerKey]
  );
  const loadingProfiles = profileSnapshot?.loadingDiscordIds.length ?? 0;
  const hasRoster = roster !== undefined;
  const refreshCooldownMs = getRefreshCooldownMs(profileSnapshot?.updatedAt, now);
  const canRefresh = hasRoster && loadingProfiles === 0 && refreshCooldownMs === 0;
  const profileStatusLabel = hasRoster ? getProfileSnapshotStatus(profileSnapshot, loadingProfiles, now) : undefined;

  useEffect(() => {
    if (selectedPlayerKey !== undefined && selectedPlayerContext === undefined) {
      setSelectedPlayerKey(undefined);
    }
  }, [selectedPlayerContext, selectedPlayerKey]);

  const selectStatsScope = (nextStatsScope: PlayerStatsScope) => {
    setStatsScope(nextStatsScope);
    void browser.storage.local.set({ [STATS_SCOPE_STORAGE_KEY]: nextStatsScope });
  };

  const refreshProfiles = () => {
    if (roster === undefined || !canRefresh) {
      return;
    }

    void sendLobbyReconnectRequest().then((result) => {
      if (result?.activeLobby !== true || result.matchCode !== roster.matchCode) {
        return;
      }

      void sendProfileRefreshRequest(roster);
    });
  };

  return (
    <main className={`app-shell surface-scout scene-${activeScene}`}>
      <header className="app-header">
        <div>
          <h1>UmaLytics</h1>
          <p className="app-credits">
            UmaLytics by{' '}
            <a href="https://github.com/kjunodev/umalytics" target="_blank" rel="noreferrer">
              k.juno
            </a>
            {' '} - Uma Drafter by{' '}
            <a href="https://drafter.uma.guide" target="_blank" rel="noreferrer">
              Terumi
            </a>
          </p>
          <p>{roster?.matchCode === undefined ? 'Lobby scouting' : `Match ${roster.matchCode}`}</p>
          {profileStatusLabel === undefined ? null : (
            <p className="profile-freshness">{profileStatusLabel}</p>
          )}
          <div className="scene-toggle" aria-label="UmaLytics scene">
            <button
              type="button"
              className={activeScene === 'lobby' ? 'active' : ''}
              onClick={() => {
                setSelectedPlayerKey(undefined);
                setActiveScene('lobby');
              }}
            >
              Lobby
            </button>
            <button
              type="button"
              className={activeScene === 'draft' ? 'active' : ''}
              onClick={() => {
                setSelectedPlayerKey(undefined);
                setActiveScene('draft');
              }}
            >
              Draft
            </button>
            <button
              type="button"
              className={activeScene === 'umas' ? 'active' : ''}
              onClick={() => {
                setSelectedPlayerKey(undefined);
                setActiveScene('umas');
              }}
            >
              Umas
            </button>
          </div>
        </div>
        <div className="header-actions">
          <div className="header-control-row">
            {hasRoster ? (
              <button
                type="button"
                className="refresh-button"
                disabled={!canRefresh}
                onClick={refreshProfiles}
              >
                {loadingProfiles > 0
                  ? 'Refreshing'
                  : refreshCooldownMs > 0
                    ? `Wait ${Math.ceil(refreshCooldownMs / 1000)}s`
                    : 'Refresh data'}
              </button>
            ) : null}
            <span className={roster === undefined ? 'status-pill idle' : 'status-pill live'}>
              {roster === undefined ? 'Waiting' : `${roster.players.length}/10`}
            </span>
          </div>
          <div className="stats-scope-toggle" aria-label="Stats time window">
            <button
              type="button"
              className={statsScope === 'currentSeason' ? 'active' : ''}
              title="Show current season records, scoring, and Uma stats."
              onClick={() => {
                selectStatsScope('currentSeason');
              }}
            >
              Season
            </button>
            <button
              type="button"
              className={statsScope === 'allTime' ? 'active' : ''}
              title="Show all-time ranked records, scoring, and Uma stats. Rank still uses the active season leaderboard."
              onClick={() => {
                selectStatsScope('allTime');
              }}
            >
              All-time
            </button>
          </div>
        </div>
      </header>

      {roster === undefined ? (
        <section className="empty-state">
          <h2>No lobby detected</h2>
          <p>Open an Uma Drafter lobby or spectate page to populate player scouting.</p>
        </section>
      ) : selectedPlayerContext !== undefined ? (
        <PlayerDetailScene
          team={selectedPlayerContext.team}
          player={selectedPlayerContext.player}
          profile={profileSnapshot?.profiles[selectedPlayerContext.player.discordId]}
          isProfileLoading={
            profileSnapshot?.loadingDiscordIds.includes(selectedPlayerContext.player.discordId) ?? false
          }
          statsScope={statsScope}
          now={now}
          onBack={() => {
            setSelectedPlayerKey(undefined);
          }}
        />
      ) : activeScene === 'draft' ? (
        <DraftScene
          snapshot={draftSnapshot}
          roster={roster}
          profiles={profileSnapshot?.profiles ?? {}}
          statsScope={statsScope}
        />
      ) : activeScene === 'umas' ? (
        <UmaPlannerScene
          roster={roster}
          profiles={profileSnapshot?.profiles ?? {}}
          statsScope={statsScope}
        />
      ) : (
        <section className="team-list" aria-label="Detected lobby teams">
          {teamGroups.map((team) => (
            <TeamSection
              key={team.id}
              team={team}
              profiles={profileSnapshot?.profiles ?? {}}
              loadingDiscordIds={profileSnapshot?.loadingDiscordIds ?? []}
              statsScope={statsScope}
              onSelectPlayer={setSelectedPlayerKey}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function DraftScene({
  snapshot,
  roster,
  profiles,
  statsScope
}: {
  snapshot: DraftSnapshot | undefined;
  roster: PrematchRoster | undefined;
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
}) {
  const scopeLabel = statsScope === 'currentSeason' ? 'current season' : 'all-time';

  if (snapshot === undefined) {
    return (
      <section className="empty-state">
        <h2>No draft data detected</h2>
        <p>Open an active Uma Drafter draft to mirror maps, picks, and bans.</p>
      </section>
    );
  }

  return (
    <section className="draft-scene" aria-label="Live draft view">
      <header className="draft-scene-header">
        <div>
          <h2>Live Draft</h2>
          <p>
            {snapshot.phase === undefined ? 'Draft phase unknown' : formatDraftPhase(snapshot.phase)}
            {snapshot.currentTeam === undefined ? '' : ` - ${formatTeamName(snapshot.teams[snapshot.currentTeam])} turn`}
          </p>
          {snapshot.tiebreakerMap === undefined ? null : (
            <p className="draft-tiebreaker">
              Tiebreaker: <strong>{formatTiebreakerMap(snapshot.tiebreakerMap)}</strong>
            </p>
          )}
        </div>
        <span title={`Uma experience checks each team's loaded ${scopeLabel} ranked Uma history.`}>
          Using team {formatStatsScopeShortLabel(statsScope)} history
        </span>
      </header>

      <div className="draft-team-grid">
        {TEAM_IDS.map((teamId) => (
          <DraftTeamPanel
            key={teamId}
            team={snapshot.teams[teamId]}
            rosterPlayers={getDraftRosterPlayersForTeam(roster, teamId)}
            profiles={profiles}
            statsScope={statsScope}
          />
        ))}
      </div>
    </section>
  );
}

function UmaPlannerScene({
  roster,
  profiles,
  statsScope
}: {
  roster: PrematchRoster;
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<UmaCatalogSortMode>('lobbyHits');
  const [hitScope, setHitScope] = useState<UmaCatalogHitScope>('all');
  const [pinnedUmaIds, setPinnedUmaIds] = useState<string[]>([]);
  const catalog = useMemo(() => getUmaCatalogOptions(profiles, statsScope), [profiles, statsScope]);
  const hitScopePlayers = useMemo(
    () => getRosterPlayersForHitScope(roster, hitScope),
    [hitScope, roster]
  );
  const historyCounts = useMemo(
    () => getUmaHistoryCounts(catalog, hitScopePlayers, profiles, statsScope),
    [catalog, hitScopePlayers, profiles, statsScope]
  );
  const filteredCatalog = useMemo(
    () => sortUmaCatalogOptions(filterUmaCatalogOptions(catalog, searchQuery), sortMode, historyCounts),
    [catalog, historyCounts, searchQuery, sortMode]
  );
  const [selectedUmaId, setSelectedUmaId] = useState<string | undefined>();
  const selectedUma = filteredCatalog.find((uma) => uma.umaId === selectedUmaId) ?? filteredCatalog[0];
  const lobbyHitTotal = useMemo(
    () => Array.from(historyCounts.values()).filter((count) => count > 0).length,
    [historyCounts]
  );
  const hitScopeLabel = getHitScopeLabel(hitScope);
  const pinnedUmas = useMemo(
    () => pinnedUmaIds
      .map((umaId) => catalog.find((uma) => uma.umaId === umaId))
      .filter((uma): uma is UmaCatalogOption => uma !== undefined),
    [catalog, pinnedUmaIds]
  );

  useEffect(() => {
    if (filteredCatalog.length === 0) {
      setSelectedUmaId(undefined);
      return;
    }

    if (selectedUmaId === undefined || !filteredCatalog.some((uma) => uma.umaId === selectedUmaId)) {
      const firstUma = filteredCatalog[0];

      if (firstUma !== undefined) {
        setSelectedUmaId(firstUma.umaId);
      }
    }
  }, [filteredCatalog, selectedUmaId]);

  return (
    <section className="uma-planner-scene" aria-label="Uma planner">
      <div className="uma-planner-layout">
        <UmaPlanningPanel
          selectedUma={selectedUma}
          roster={roster}
          profiles={profiles}
          statsScope={statsScope}
          pinnedUmas={pinnedUmas}
          onPinUma={(umaId) => {
            setPinnedUmaIds((current) => {
              if (current.includes(umaId)) {
                return current;
              }

              return [umaId, ...current].slice(0, DRAFT_PLAN_PIN_LIMIT);
            });
          }}
          onRemovePinnedUma={(umaId) => {
            setPinnedUmaIds((current) => current.filter((pinnedUmaId) => pinnedUmaId !== umaId));
          }}
          onSelectUma={setSelectedUmaId}
        />

        <section className="uma-catalog-panel" aria-label="Uma catalog">
          <div className="uma-catalog-toolbar">
            <div className="uma-catalog-heading">
              <strong>Uma Catalog</strong>
              <span>
                {filteredCatalog.length} {searchQuery.trim().length === 0 ? 'Umas' : 'matches'} - {lobbyHitTotal} {hitScopeLabel} hits
              </span>
            </div>
            <div className="uma-catalog-controls">
              <label className="uma-search" aria-label="Search Umas">
                <input
                  type="search"
                  value={searchQuery}
                  placeholder="Search Umas"
                  onChange={(event) => {
                    setSearchQuery(event.currentTarget.value);
                  }}
                />
              </label>
              <div className="uma-sort" aria-label="Sort Uma catalog">
                <UmaCatalogSortMenu value={sortMode} onChange={setSortMode} />
              </div>
              <div className="uma-hit-scope" aria-label="Catalog hit scope">
                <div className="uma-hit-scope-toggle">
                  {UMA_CATALOG_HIT_SCOPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={option.value === hitScope ? 'active' : ''}
                      onClick={() => {
                        setHitScope(option.value);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {filteredCatalog.length === 0 ? (
            <div className="uma-catalog-empty">
              <strong>No matching Umas</strong>
              <span>Try a different search.</span>
            </div>
          ) : (
            <div className="uma-catalog-grid">
              {filteredCatalog.map((uma) => (
                <UmaCatalogButton
                  key={uma.umaId}
                  uma={uma}
                  isSelected={uma.umaId === selectedUma?.umaId}
                  historyCount={historyCounts.get(uma.umaId) ?? 0}
                  onSelect={setSelectedUmaId}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function UmaCatalogSortMenu({
  value,
  onChange
}: {
  value: UmaCatalogSortMode;
  onChange: (value: UmaCatalogSortMode) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = UMA_CATALOG_SORT_OPTIONS.find((option) => option.value === value)
    ?? DEFAULT_UMA_CATALOG_SORT_OPTION;

  return (
    <div
      className={isOpen ? 'uma-sort-menu open' : 'uma-sort-menu'}
      onBlur={(event) => {
        const nextFocusedElement = event.relatedTarget instanceof Node ? event.relatedTarget : null;

        if (!event.currentTarget.contains(nextFocusedElement)) {
          setIsOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="uma-sort-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((current) => !current);
        }}
      >
        <span>{selectedOption.label}</span>
        <span className="uma-sort-chevron" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="uma-sort-options" role="listbox" aria-label="Sort Uma catalog">
          {UMA_CATALOG_SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === value ? 'selected' : ''}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UmaCatalogButton({
  uma,
  isSelected,
  historyCount,
  onSelect
}: {
  uma: UmaCatalogOption;
  isSelected: boolean;
  historyCount: number;
  onSelect: (umaId: string) => void;
}) {
  return (
    <button
      type="button"
      className={isSelected ? 'uma-catalog-button selected' : 'uma-catalog-button'}
      aria-pressed={isSelected}
      title={uma.name}
      onClick={() => {
        onSelect(uma.umaId);
      }}
    >
      <span className="uma-catalog-portrait">
        <UmaImage imageUrl={uma.imageUrl} name={uma.name} />
        {historyCount > 0 ? <span className="uma-catalog-count">{historyCount}</span> : null}
      </span>
      <span className="uma-catalog-name">{uma.name}</span>
    </button>
  );
}

function UmaPlanningPanel({
  selectedUma,
  roster,
  profiles,
  statsScope,
  pinnedUmas,
  onPinUma,
  onRemovePinnedUma,
  onSelectUma
}: {
  selectedUma: UmaCatalogOption | undefined;
  roster: PrematchRoster;
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
  pinnedUmas: UmaCatalogOption[];
  onPinUma: (umaId: string) => void;
  onRemovePinnedUma: (umaId: string) => void;
  onSelectUma: (umaId: string) => void;
}) {
  if (selectedUma === undefined) {
    return (
      <section className="uma-planning-panel empty" aria-label="Selected Uma history">
        <h3>No Uma selected</h3>
      </section>
    );
  }

  const action = getUmaCatalogAction(selectedUma);
  const teams = getTeamGroups(roster);
  const totalExperience = getUmaExperience(action, roster.players, profiles, statsScope).length;
  const scopeLabel = formatStatsScopeShortLabel(statsScope);
  const isPinned = pinnedUmas.some((uma) => uma.umaId === selectedUma.umaId);
  const teamSummaries = TEAM_IDS.map((teamId) => {
    const team = teams.find((team) => team.id === teamId);
    const players = team?.players ?? [];
    const historyCount = players.filter((player) =>
      findScopedUmaEntry(action, profiles[player.discordId], statsScope) !== undefined
    ).length;

    return {
      id: teamId,
      name: team?.name ?? (teamId === 'team1' ? 'Team 1' : 'Team 2'),
      historyCount,
      playerCount: players.length
    };
  });

  return (
    <section className="uma-planning-panel" aria-label={`${selectedUma.name} lobby history`}>
      <header className="uma-planning-heading">
        <span className="uma-planning-portrait">
          <UmaImage imageUrl={selectedUma.imageUrl} name={selectedUma.name} loading="eager" />
        </span>
        <div className="uma-planning-title">
          <h3>{selectedUma.name}</h3>
          <p>
            {totalExperience} {totalExperience === 1 ? 'player' : 'players'} with {scopeLabel} history
          </p>
          <button
            type="button"
            className={isPinned ? 'uma-pin-button pinned' : 'uma-pin-button'}
            disabled={isPinned}
            onClick={() => {
              onPinUma(selectedUma.umaId);
            }}
          >
            {isPinned ? 'Pinned' : 'Pin to plan'}
          </button>
        </div>

        <div className="uma-planning-summary" aria-label={`${selectedUma.name} lobby history summary`}>
          <span>
            <strong>{totalExperience}/{roster.players.length}</strong>
            <small>Lobby players</small>
          </span>
          <span>
            <strong>{scopeLabel}</strong>
            <small>Stat scope</small>
          </span>
          {teamSummaries.map((team) => (
            <span key={team.id}>
              <strong>{team.historyCount}/{team.playerCount}</strong>
              <small>{team.name}</small>
            </span>
          ))}
        </div>
      </header>

      <div className="uma-planning-team-grid">
        {TEAM_IDS.map((teamId) => (
          <UmaPlanningTeamPanel
            key={teamId}
            team={teams.find((team) => team.id === teamId)}
            fallbackTeamId={teamId}
            action={action}
            profiles={profiles}
            statsScope={statsScope}
          />
        ))}
      </div>

      <DraftPlanTray
        pinnedUmas={pinnedUmas}
        roster={roster}
        profiles={profiles}
        statsScope={statsScope}
        selectedUmaId={selectedUma.umaId}
        onSelectUma={onSelectUma}
        onRemoveUma={onRemovePinnedUma}
      />
    </section>
  );
}

function DraftPlanTray({
  pinnedUmas,
  roster,
  profiles,
  statsScope,
  selectedUmaId,
  onSelectUma,
  onRemoveUma
}: {
  pinnedUmas: UmaCatalogOption[];
  roster: PrematchRoster;
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
  selectedUmaId: string;
  onSelectUma: (umaId: string) => void;
  onRemoveUma: (umaId: string) => void;
}) {
  const teams = getTeamGroups(roster);
  const scopeLabel = formatStatsScopeShortLabel(statsScope);

  return (
    <section className="draft-plan-tray" aria-label="Draft plan">
      <header>
        <div>
          <h4>Draft Plan</h4>
          <p>Pinned Umas for this lobby</p>
        </div>
        <span>
          {pinnedUmas.length}/{DRAFT_PLAN_PIN_LIMIT}
        </span>
      </header>
      {pinnedUmas.length === 0 ? (
        <div className="draft-plan-empty">Pin Umas from the catalog to build a short plan.</div>
      ) : (
        <div className="draft-plan-list">
          {pinnedUmas.map((uma) => {
            const action = getUmaCatalogAction(uma);
            const totalExperience = getUmaExperience(action, roster.players, profiles, statsScope).length;
            const teamSummaries = TEAM_IDS.map((teamId) => {
              const team = teams.find((team) => team.id === teamId);
              const players = team?.players ?? [];
              const historyCount = players.filter((player) =>
                findScopedUmaEntry(action, profiles[player.discordId], statsScope) !== undefined
              ).length;

              return `${teamId === 'team1' ? 'T1' : 'T2'} ${historyCount}/${players.length}`;
            });

            return (
              <article
                key={uma.umaId}
                className={uma.umaId === selectedUmaId ? 'draft-plan-card selected' : 'draft-plan-card'}
              >
                <button
                  type="button"
                  className="draft-plan-select"
                  onClick={() => {
                    onSelectUma(uma.umaId);
                  }}
                  title={`Show ${uma.name}`}
                >
                  <span className="draft-plan-portrait">
                    <UmaImage imageUrl={uma.imageUrl} name={uma.name} />
                  </span>
                  <span>
                    <strong>{uma.name}</strong>
                    <small>
                      {totalExperience}/{roster.players.length} {scopeLabel}
                    </small>
                    <small>{teamSummaries.join(' - ')}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="draft-plan-remove"
                  onClick={() => {
                    onRemoveUma(uma.umaId);
                  }}
                  aria-label={`Remove ${uma.name} from draft plan`}
                >
                  x
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function UmaPlanningTeamPanel({
  team,
  fallbackTeamId,
  action,
  profiles,
  statsScope
}: {
  team: PrematchTeam | undefined;
  fallbackTeamId: TeamId;
  action: DraftUmaAction;
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
}) {
  const players = getDraftSlots(team?.players ?? [], TEAM_SLOT_COUNT);
  const historyCount = (team?.players ?? []).filter((player) =>
    findScopedUmaEntry(action, profiles[player.discordId], statsScope) !== undefined
  ).length;

  return (
    <article className={`uma-planning-team ${fallbackTeamId}`}>
      <header>
        <h4>{team?.name ?? (fallbackTeamId === 'team1' ? 'Team 1' : 'Team 2')}</h4>
        <p>
          {historyCount}/{team?.players.length ?? 0} with {formatStatsScopeShortLabel(statsScope)} history
        </p>
      </header>
      <ol className="uma-planning-slots">
        {players.map((player, index) => (
          <UmaPlanningPlayerSlot
            key={player === undefined ? `${fallbackTeamId}:empty:${index}` : getPlayerKey(player)}
            player={player}
            action={action}
            profile={player === undefined ? undefined : profiles[player.discordId]}
            statsScope={statsScope}
            slotNumber={index + 1}
          />
        ))}
      </ol>
    </article>
  );
}

function UmaPlanningPlayerSlot({
  player,
  action,
  profile,
  statsScope,
  slotNumber
}: {
  player: PrematchPlayer | undefined;
  action: DraftUmaAction;
  profile: PlayerProfileSummary | undefined;
  statsScope: PlayerStatsScope;
  slotNumber: number;
}) {
  if (player === undefined) {
    return (
      <li className="uma-planning-player empty">
        <strong>Open slot</strong>
        <span>Slot {slotNumber}</span>
      </li>
    );
  }

  const uma = findScopedUmaEntry(action, profile, statsScope);

  return (
    <li className={uma === undefined ? 'uma-planning-player no-history' : 'uma-planning-player'}>
      <strong>{profile?.displayName ?? player.displayName}</strong>
      {uma === undefined ? (
        <span>No games played</span>
      ) : (
        <span className="uma-planning-stats">
          <span>
            <small>Games</small>
            <b>{uma.matches}</b>
          </span>
          <span>
            <small>PPG</small>
            <b>{formatDecimal(uma.pointsPerGame)}</b>
          </span>
          <span>
            <small>Win rate</small>
            <b>{formatPercent(uma.winRate)}</b>
          </span>
        </span>
      )}
    </li>
  );
}

function DraftTeamPanel({
  team,
  rosterPlayers,
  profiles,
  statsScope
}: {
  team: DraftTeamSnapshot;
  rosterPlayers: PrematchPlayer[];
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
}) {
  const picks = team.umas.filter((uma) => uma.kind === 'pick');
  const bans = team.umas.filter((uma) => uma.kind === 'ban');
  const vetoes = team.umas.filter((uma) => uma.kind === 'veto');
  const pickSignature = picks.map(getDraftActionKey).join('|');
  const [selectedPickKey, setSelectedPickKey] = useState<string | undefined>();

  useEffect(() => {
    const latestPick = picks.at(-1);

    setSelectedPickKey(latestPick === undefined ? undefined : getDraftActionKey(latestPick));
  }, [pickSignature]);

  return (
    <article className={`draft-team-panel ${team.id}`}>
      <header>
        <h3>{formatTeamName(team)}</h3>
        <p>{team.maps.length} maps - {picks.length} picks</p>
      </header>

      <DraftMapList maps={team.maps} />
      <DraftPickBoard
        picks={picks}
        selectedPickKey={selectedPickKey}
        onSelectPick={setSelectedPickKey}
        rosterPlayers={rosterPlayers}
        profiles={profiles}
        statsScope={statsScope}
      />
      <DraftBanRow bans={bans} vetoes={vetoes} />
    </article>
  );
}

function DraftMapList({ maps }: { maps: DraftTeamSnapshot['maps'] }) {
  const slots = getDraftSlots(maps, DRAFT_MAP_SLOT_COUNT);

  return (
    <section className="draft-card-section draft-map-section">
      <p>Maps</p>
      <ol className="draft-map-list">
        {slots.map((map, index) => (
          map === undefined ? (
            <li key={`map-placeholder:${index}`} className="placeholder">
              <span className="draft-map-order">{index + 1}</span>
              <strong>Pending map</strong>
              <small>Waiting for draft update</small>
            </li>
          ) : (
            <li
              key={`${map.team}:${map.order ?? map.name}:${map.name}`}
              className={map.status === 'vetoed' ? 'vetoed' : ''}
            >
              <span className="draft-map-order">{map.order ?? '-'}</span>
              <strong title={formatDraftMapTitle(map)}>
                {map.name}
              </strong>
              {formatDraftMapDetails(map) === undefined ? null : <small>{formatDraftMapDetails(map)}</small>}
              {map.status === 'vetoed' ? <span className="draft-map-status">Vetoed</span> : null}
            </li>
          )
        ))}
      </ol>
    </section>
  );
}

function DraftBanRow({
  bans,
  vetoes
}: {
  bans: DraftUmaAction[];
  vetoes: DraftUmaAction[];
}) {
  const slots = [
    ...getDraftSlots(bans, DRAFT_BAN_SLOT_COUNT).map((action) => ({
      action,
      kind: 'ban' as const,
      label: 'Pending ban'
    })),
    ...getDraftSlots(vetoes, DRAFT_VETO_SLOT_COUNT).map((action) => ({
      action,
      kind: 'veto' as const,
      label: 'Pending veto'
    }))
  ];

  return (
    <section className="draft-card-section draft-ban-section">
      <p>Banned</p>
      <ol className="draft-uma-list">
        {slots.map(({ action, kind, label }, index) => (
          action === undefined ? (
            <DraftUmaPlaceholderRow
              key={`${kind}:placeholder:${index}`}
              kind={kind}
              label={label}
            />
          ) : (
            <DraftUmaActionRow
              key={`${action.kind}:${action.team}:${action.order ?? action.umaId ?? action.name}`}
              action={action}
            />
          )
        ))}
      </ol>
    </section>
  );
}

function DraftPickBoard({
  picks,
  selectedPickKey,
  onSelectPick,
  rosterPlayers,
  profiles,
  statsScope
}: {
  picks: DraftUmaAction[];
  selectedPickKey: string | undefined;
  onSelectPick: (key: string) => void;
  rosterPlayers: PrematchPlayer[];
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
}) {
  const slots = getDraftSlots(picks, DRAFT_PICK_SLOT_COUNT);
  const selectedPick = picks.find((pick) => getDraftActionKey(pick) === selectedPickKey);

  return (
    <section className="draft-card-section draft-pick-section">
      <p>Picked Umas</p>
      <ol className="draft-pick-slots">
        {slots.map((action, index) => (
          action === undefined ? (
            <li key={`pick-placeholder:${index}`} className="draft-pick-slot placeholder">
              <span className="draft-pick-icon">
                <span>?</span>
              </span>
              <small>Pending</small>
            </li>
          ) : (
            <DraftPickSlot
              key={getDraftActionKey(action)}
              action={action}
              experienceCount={getUmaExperience(action, rosterPlayers, profiles, statsScope).length}
              isSelected={getDraftActionKey(action) === selectedPickKey}
              onSelect={() => onSelectPick(getDraftActionKey(action))}
            />
          )
        ))}
      </ol>
      <DraftPickExperiencePanel
        action={selectedPick}
        rosterPlayers={rosterPlayers}
        profiles={profiles}
        statsScope={statsScope}
      />
    </section>
  );
}

function DraftPickSlot({
  action,
  experienceCount,
  isSelected,
  onSelect
}: {
  action: DraftUmaAction;
  experienceCount: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const imageUrl = action.imageUrl ?? (action.umaId === undefined ? undefined : getUmaPortraitUrl(action.umaId));

  return (
    <li className="draft-pick-slot">
      <button
        type="button"
        className={isSelected ? 'selected' : ''}
        onClick={onSelect}
        title={action.name}
      >
        <span className="draft-pick-icon">
          <UmaImage imageUrl={imageUrl} name={action.name} />
        </span>
        {experienceCount > 0 ? <span className="draft-pick-count">{experienceCount}</span> : null}
      </button>
      <small>{action.name}</small>
    </li>
  );
}

function DraftPickExperiencePanel({
  action,
  rosterPlayers,
  profiles,
  statsScope
}: {
  action: DraftUmaAction | undefined;
  rosterPlayers: PrematchPlayer[];
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
}) {
  const playerSlots = getDraftSlots(rosterPlayers, TEAM_SLOT_COUNT);
  const experienceCount = action === undefined
    ? 0
    : playerSlots.filter((player) =>
      player !== undefined && getUmaExperienceForPlayer(action, player, profiles, statsScope) !== undefined
    ).length;

  return (
    <div className="draft-pick-experience-panel">
      <div className="draft-pick-experience-heading">
        <strong>{action?.name ?? 'Select a picked Uma'}</strong>
        <span>
          {action === undefined
            ? 'Waiting for picks'
            : `${experienceCount} players with ${formatStatsScopeShortLabel(statsScope)} history`}
        </span>
      </div>
      {action === undefined ? (
        <small className="draft-empty-history">Pick history appears here after an Uma is selected.</small>
      ) : (
        <ol className="draft-pick-experience-list">
          {playerSlots.map((player, index) => {
            const experience = player === undefined
              ? undefined
              : getUmaExperienceForPlayer(action, player, profiles, statsScope);
            const displayName = player === undefined
              ? ''
              : profiles[player.discordId]?.displayName ?? player.displayName;

            return (
              <li
                key={player === undefined ? `experience-slot:${index}` : `${player.discordId}:${player.userId}`}
                className={experience === undefined ? 'no-history' : ''}
              >
                <strong title={displayName}>{displayName}</strong>
                {experience === undefined ? (
                  <span className="draft-no-history-text">No games played</span>
                ) : (
                  <span>{experience.matches} GP - {formatDecimal(experience.pointsPerGame)} PPG</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function getUmaExperienceForPlayer(
  action: DraftUmaAction,
  player: PrematchPlayer,
  profiles: Record<string, PlayerProfileSummary>,
  statsScope: PlayerStatsScope
): PlayerTopUmaSummary | undefined {
  return findScopedUmaEntry(action, profiles[player.discordId], statsScope);
}

function DraftUmaPlaceholderRow({
  kind,
  label
}: {
  kind?: DraftUmaAction['kind'];
  label: string;
}) {
  return (
    <li className={`draft-uma-row placeholder ${kind ?? ''} no-history`}>
      <span className="draft-uma-main">
        <span className="draft-uma-portrait">
          <span>?</span>
        </span>
        <span className="draft-uma-copy">
          <strong>{label}</strong>
          <small>Waiting for draft update</small>
        </span>
      </span>
    </li>
  );
}

function DraftUmaActionRow({
  action
}: {
  action: DraftUmaAction;
}) {
  const imageUrl = action.imageUrl ?? (action.umaId === undefined ? undefined : getUmaPortraitUrl(action.umaId));

  return (
    <li className={`draft-uma-row ${action.kind} no-history`}>
      <span className="draft-uma-main">
        <span className="draft-uma-portrait">
          <UmaImage imageUrl={imageUrl} name={action.name} />
        </span>
        <span className="draft-uma-copy">
          <strong>{action.name}</strong>
          <small>{formatDraftUmaKind(action.kind)}</small>
        </span>
      </span>
    </li>
  );
}

function getDraftSlots<T>(items: T[], slotCount: number): Array<T | undefined> {
  const visibleItems = items.slice(0, slotCount);

  return [
    ...visibleItems,
    ...Array<T | undefined>(Math.max(slotCount - visibleItems.length, 0)).fill(undefined)
  ];
}

function getDraftActionKey(action: DraftUmaAction): string {
  return `${action.kind}:${action.team}:${action.order ?? 'pending'}:${action.umaId ?? action.name}`;
}

function TeamSection({
  team,
  profiles,
  loadingDiscordIds,
  statsScope,
  onSelectPlayer
}: {
  team: PrematchTeam;
  profiles: Record<string, PlayerProfileSummary>;
  loadingDiscordIds: string[];
  statsScope: PlayerStatsScope;
  onSelectPlayer: (playerKey: string) => void;
}) {
  const playerSlots = Array.from({ length: TEAM_SLOT_COUNT }, (_, index) => team.players[index]);
  const partyVisuals = useMemo(() => getTeamPartyVisuals(team.players), [team.players]);

  return (
    <section className="team-section">
      <header className="team-header">
        <div>
          <h2>{team.name ?? team.id}</h2>
          <p>{Math.min(team.players.length, TEAM_SLOT_COUNT)}/{TEAM_SLOT_COUNT} players</p>
        </div>
      </header>

      <ol className="player-list">
        {playerSlots.map((player, index) => (
          player === undefined ? (
            <EmptyPlayerSlot key={`${team.id}:empty:${index}`} slotNumber={index + 1} />
          ) : (
            <PlayerRow
              key={getPlayerKey(player)}
              player={player}
              profile={profiles[player.discordId]}
              isProfileLoading={loadingDiscordIds.includes(player.discordId)}
              statsScope={statsScope}
              partyVisual={getPlayerPartyVisual(player, partyVisuals)}
              onShowDetails={() => {
                onSelectPlayer(getPlayerKey(player));
              }}
            />
          )
        ))}
      </ol>
    </section>
  );
}

function PlayerRow({
  player,
  profile,
  isProfileLoading,
  statsScope,
  partyVisual,
  onShowDetails
}: {
  player: PrematchPlayer;
  profile?: PlayerProfileSummary;
  isProfileLoading: boolean;
  statsScope: PlayerStatsScope;
  partyVisual?: PartyVisual;
  onShowDetails: () => void;
}) {
  const displayedProfile = getDisplayedProfileStats(profile, statsScope);
  const rating = profile?.conservativeRating ?? profile?.rating ?? player.displayRatingSnapshot ?? player.ratingSnapshot;
  const discordId = getLookupDiscordId(player);
  const profileUrl = profile?.profileUrl ?? player.profileUrl;
  const note = getPlayerNote(profile, discordId);
  const statsMessage = getStatsMessage(profile, isProfileLoading, discordId);
  const notableBadges = getNotableBadges(displayedProfile);
  const isCaptain = player.isCaptain === true || player.role === 'captain';
  const displayName = profile?.displayName ?? player.displayName;

  return (
    <li className={getPlayerRowClassName(partyVisual)}>
      <div className="player-main">
        {profileUrl === undefined ? (
          <span className="player-name-row">
            <span className="player-identity">
              <span className="player-name" title={displayName}>{displayName}</span>
            </span>
            <span className="player-actions">
              {isCaptain ? <CaptainCrown /> : null}
              <button type="button" className="expand-button" onClick={onShowDetails}>
                Details
              </button>
              {isProfileLoading && discordId !== undefined ? (
                <span className="player-inline-status">Refreshing</span>
              ) : null}
            </span>
          </span>
        ) : (
          <span className="player-name-row">
            <span className="player-identity">
              <a className="player-name" href={profileUrl} target="_blank" rel="noreferrer" title={displayName}>
                {displayName}
              </a>
            </span>
            <span className="player-actions">
              {isCaptain ? <CaptainCrown /> : null}
              <button type="button" className="expand-button" onClick={onShowDetails}>
                Details
              </button>
              {isProfileLoading && discordId !== undefined ? (
                <span className="player-inline-status">Refreshing</span>
              ) : null}
            </span>
          </span>
        )}
        <span className="player-id">{discordId ?? 'Profile unavailable from room page'}</span>
        <span className="player-title">{profile?.title ?? ' '}</span>
      </div>
      <div className="player-meta">
        <span className="player-rank-line">
          <span>{formatRank(profile, isProfileLoading && discordId !== undefined)}</span>
          <span>{rating === undefined || rating === null ? 'Rating unknown' : `${rating} rating`}</span>
        </span>
        <span className="player-badge-row">
          {partyVisual === undefined ? null : (
            <span className={`identity-tag ${partyVisual.className}`} title={partyVisual.title}>
              {partyVisual.label}
            </span>
          )}
          {notableBadges.map((badge) => (
            <span
              key={badge.label}
              className={`player-tag notable-tag ${badge.tone}`}
              title={badge.title}
            >
              {badge.label}
            </span>
          ))}
        </span>
      </div>
      <div className="scouting-grid compact-scouting-grid" aria-label={`${player.displayName} scouting summary`}>
        <StatCell
          label="W-L"
          value={formatRecord(displayedProfile)}
          title="Ranked win-loss record for the selected stat scope."
          variant="record"
        />
        <StatCell label="Win" value={formatPercent(displayedProfile?.winRate)} title="Ranked win rate for the selected stat scope." />
        <StatCell label="PPG" value={formatDecimal(displayedProfile?.pointsPerGame)} title="Average ranked points per game for the selected stat scope." />
        <StatCell label="MVP" value={formatNumber(displayedProfile?.mvpMatches)} title="Total ranked MVP games for the selected stat scope." />
      </div>
      <TopUmasList
        topUmas={displayedProfile?.topUmas}
        playerName={player.displayName}
        emptyMessage={statsMessage}
      />
      <p className={note === undefined ? 'player-note empty' : 'player-note'}>{note ?? ' '}</p>
    </li>
  );
}

function PlayerDetailScene({
  team,
  player,
  profile,
  isProfileLoading,
  statsScope,
  now,
  onBack
}: {
  team: PrematchTeam;
  player: PrematchPlayer;
  profile?: PlayerProfileSummary;
  isProfileLoading: boolean;
  statsScope: PlayerStatsScope;
  now: number;
  onBack: () => void;
}) {
  const displayedProfile = getDisplayedProfileStats(profile, statsScope);
  const rating = profile?.conservativeRating ?? profile?.rating ?? player.displayRatingSnapshot ?? player.ratingSnapshot;
  const discordId = getLookupDiscordId(player);
  const profileUrl = profile?.profileUrl ?? player.profileUrl;
  const note = getPlayerNote(profile, discordId);
  const statsMessage = getStatsMessage(profile, isProfileLoading, discordId);
  const notableBadges = getNotableBadges(displayedProfile);
  const partyVisual = getPlayerPartyVisual(player, getTeamPartyVisuals(team.players));
  const isCaptain = player.isCaptain === true || player.role === 'captain';

  return (
    <section className="player-detail-scene" aria-label={`${player.displayName} scouting details`}>
      <header className="detail-header">
        <button type="button" className="back-button" onClick={onBack}>
          Back to lobby
        </button>
        <div className="detail-title">
          <span>{team.name ?? team.id}</span>
          {profileUrl === undefined ? (
            <h2>{profile?.displayName ?? player.displayName}</h2>
          ) : (
            <h2>
              <a href={profileUrl} target="_blank" rel="noreferrer">
                {profile?.displayName ?? player.displayName}
              </a>
            </h2>
          )}
          <p>{discordId ?? 'Profile unavailable from room page'}</p>
        </div>
      </header>

      <div className="detail-card detail-summary">
        <div className="detail-identity">
          <span className="player-title">{profile?.title ?? ' '}</span>
          <div className="player-meta">
            <span className="player-rank-line detail-rank-line">
              <span>{formatRank(profile, isProfileLoading && discordId !== undefined)}</span>
              <span>{rating === undefined || rating === null ? 'Rating unknown' : `${rating} rating`}</span>
            </span>
            <span className="player-badge-row detail-badge-row">
              {isCaptain ? <span className="player-tag notable-tag rank">Captain</span> : null}
              {partyVisual === undefined ? null : (
                <span className={`identity-tag ${partyVisual.className}`} title={partyVisual.title}>
                  {partyVisual.label}
                </span>
              )}
              {notableBadges.map((badge) => (
                <span
                  key={badge.label}
                  className={`player-tag notable-tag ${badge.tone}`}
                  title={badge.title}
                >
                  {badge.label}
                </span>
              ))}
            </span>
          </div>
          <ProfileDataStatus
            discordId={discordId}
            profile={profile}
            isProfileLoading={isProfileLoading}
            now={now}
          />
        </div>

        <div className="detail-stat-panel">
          <div className="scouting-grid detail-scouting-grid" aria-label={`${player.displayName} scouting summary`}>
            <StatCell
              label="W-L"
              value={formatRecord(displayedProfile)}
              title="Ranked win-loss record for the selected stat scope."
              variant="record"
            />
            <StatCell label="Win Rate" value={formatPercent(displayedProfile?.winRate)} title="Ranked win rate for the selected stat scope." />
            <StatCell label="Pts/GP" value={formatDecimal(displayedProfile?.pointsPerGame)} title="Average ranked points per game for the selected stat scope." />
            <StatCell label="MVP" value={formatNumber(displayedProfile?.mvpMatches)} title="Total ranked MVP games for the selected stat scope." />
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-card">
          <TopUmasList
            topUmas={displayedProfile?.topUmas}
            playerName={player.displayName}
            emptyMessage={statsMessage}
          />
        </div>
        <div className="detail-card">
          <ScoutingReport profile={displayedProfile} emptyMessage={statsMessage} />
        </div>
        <div className="detail-card detail-wide">
          <RecentMatchesList
            recentMatches={displayedProfile?.recentMatches}
            playerName={player.displayName}
            emptyMessage={statsMessage}
          />
        </div>
        <div className="detail-card detail-full">
          <BestUmasList
            bestUmas={displayedProfile?.bestUmas}
            playerName={player.displayName}
            emptyMessage={statsMessage}
          />
        </div>
      </div>

      <p className={note === undefined ? 'player-note empty' : 'player-note'}>{note ?? ' '}</p>
    </section>
  );
}

function CaptainCrown() {
  return (
    <span className="captain-crown" title="Captain" aria-label="Captain">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3.8 8.8 8.7 13.2 12 5.8l3.3 7.4 4.9-4.4-1.8 9.1H5.6L3.8 8.8Z" />
      </svg>
    </span>
  );
}

function EmptyPlayerSlot({ slotNumber }: { slotNumber: number }) {
  return (
    <li className="player-row empty-player-row">
      <div className="player-main">
        <span className="player-name">Waiting for player</span>
        <span className="player-id">Slot {slotNumber}</span>
        <span className="player-title"> </span>
      </div>
      <div className="player-meta">
        <span>Open slot</span>
      </div>
      <div className="scouting-grid compact-scouting-grid" aria-label={`Empty player slot ${slotNumber}`}>
        <StatCell label="W-L" value="-" title="No player in this slot yet." variant="record" />
        <StatCell label="Win" value="-" title="No player in this slot yet." />
        <StatCell label="PPG" value="-" title="No player in this slot yet." />
        <StatCell label="MVP" value="-" title="No player in this slot yet." />
      </div>
      <TopUmasList playerName={`empty slot ${slotNumber}`} emptyMessage="Waiting for player." />
      <p className="player-note empty"> </p>
    </li>
  );
}

function getLookupDiscordId(player: PrematchPlayer): string | undefined {
  return /^\d{16,20}$/.test(player.discordId) ? player.discordId : undefined;
}

function getPlayerKey(player: PrematchPlayer): string {
  return `${player.discordId}:${player.userId}`;
}

function StatCell({
  label,
  value,
  title,
  variant
}: {
  label: string;
  value: string;
  title: string;
  variant?: 'record';
}) {
  return (
    <span className={variant === 'record' ? 'stat-cell record-stat-cell' : 'stat-cell'} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function ProfileDataStatus({
  discordId,
  profile,
  isProfileLoading,
  now
}: {
  discordId: string | undefined;
  profile: PlayerProfileSummary | undefined;
  isProfileLoading: boolean;
  now: number;
}) {
  const status = getProfileDataStatus(discordId, profile, isProfileLoading, now);

  return (
    <div className={`profile-data-status ${status.tone}`}>
      <span>{status.label}</span>
    </div>
  );
}

function ScoutingReport({
  profile,
  emptyMessage
}: {
  profile: PlayerProfileSummary | undefined;
  emptyMessage?: string;
}) {
  if (profile === undefined || profile.statsPrivate === true || profile.error !== undefined) {
    return (
      <section className="scouting-report" aria-label="Player scouting report">
        <p>Scouting Report</p>
        <span className="section-message">{emptyMessage ?? 'No profile summary available.'}</span>
      </section>
    );
  }

  const comfortPick = profile.topUmas?.[0];
  const bestPick = profile.bestUmas?.[0];
  const sampleConfidence = getSampleConfidence(profile.matches);

  return (
    <section className="scouting-report" aria-label="Player scouting report">
      <p>Scouting Report</p>
      <div className="report-grid">
        <ReportMetric
          label="Comfort"
          value={comfortPick?.name ?? '-'}
          detail={formatUmaLine(comfortPick)}
          title="Most played Uma in ranked games for the selected stat scope."
        />
        <ReportMetric
          label="Best"
          value={bestPick?.name ?? '-'}
          detail={formatBestUmaLine(bestPick)}
          title="Best result signal using scoring first, with win rate and sample size as context."
        />
        <ReportMetric
          label="Sample"
          value={formatSampleConfidence(sampleConfidence)}
          detail={formatSampleDetail(profile)}
          title="How much ranked data this profile has in the selected stat scope."
        />
        <ReportMetric
          label="Scoring"
          value={formatScoringValue(profile.pointsPerGame)}
          detail={formatWinRateDetail(profile.winRate)}
          title="Average ranked points per game. Higher scoring is usually more draft-relevant than win rate alone."
        />
      </div>
    </section>
  );
}

function ReportMetric({
  label,
  value,
  detail,
  title
}: {
  label: string;
  value: string;
  detail: string;
  title: string;
}) {
  return (
    <div className="report-metric" title={title}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function TopUmasList({
  topUmas,
  playerName,
  emptyMessage
}: {
  topUmas?: PlayerProfileSummary['topUmas'];
  playerName: string;
  emptyMessage?: string;
}) {
  const slots = Array.from({ length: 3 }, (_, index) => topUmas?.[index]);
  const shouldShowMessage = topUmas === undefined || topUmas.length === 0;

  return (
    <div
      className="top-umas"
      aria-label={`${playerName} most played Umas`}
      title="Most played ranked Umas for the selected stat scope."
    >
      <p>Most Played</p>
      {shouldShowMessage ? (
        <span className="section-message">{emptyMessage ?? 'No ranked Uma data found.'}</span>
      ) : (
        <ol>
          {slots.map((uma, index) => (
            uma === undefined ? (
              <li key={`empty-uma:${index}`} className="empty-uma-row">
                <span className="uma-name">-</span>
                <span className="uma-meta">-</span>
              </li>
            ) : (
              <li key={uma.umaId}>
                <span className="uma-name" title={uma.name}>
                  {uma.name}
                </span>
                <span className="uma-meta">
                  {uma.matches} GP - {formatPercent(uma.winRate)} - {formatDecimal(uma.pointsPerGame)} PPG
                </span>
              </li>
            )
          ))}
        </ol>
      )}
    </div>
  );
}

function BestUmasList({
  bestUmas,
  playerName,
  emptyMessage
}: {
  bestUmas?: PlayerProfileSummary['bestUmas'];
  playerName: string;
  emptyMessage?: string;
}) {
  const slots = Array.from({ length: 5 }, (_, index) => bestUmas?.[index]);
  const shouldShowMessage = bestUmas === undefined || bestUmas.length === 0;

  return (
    <div
      className="top-umas best-umas"
      aria-label={`${playerName} best performing Umas`}
      title={`Best ranked Uma results with at least ${BEST_UMA_MIN_MATCHES} games. Score favors PPG, then win rate and sample size.`}
    >
      <p>Best Performing</p>
      {shouldShowMessage ? (
        <span className="section-message">
          {emptyMessage ?? `No Umas meet the ${BEST_UMA_MIN_MATCHES} game sample yet.`}
        </span>
      ) : (
        <ol>
          {slots.map((uma, index) => (
            uma === undefined ? (
              <li key={`empty-best-uma:${index}`} className="empty-uma-row">
                <span className="uma-name">-</span>
                <span className="uma-meta">-</span>
              </li>
            ) : (
              <li key={uma.umaId} className="best-uma-row">
                <span className="best-uma-heading">
                  <BestUmaPortrait uma={uma} />
                  <span className="best-uma-copy">
                    <span className="uma-name" title={uma.name}>
                      {uma.name}
                    </span>
                    <span className="best-uma-badges">
                      {getUmaBadges(uma).map((badge) => (
                        <span
                          key={badge.label}
                          className={`uma-badge ${badge.tone}`}
                          title={badge.title}
                        >
                          <small>{badge.label}</small>
                          <strong>{badge.value}</strong>
                        </span>
                      ))}
                    </span>
                  </span>
                </span>
                <span className="best-uma-stats">
                  <span>
                    <small>Score</small>
                    <strong>{formatNumber(uma.performanceScore)}</strong>
                  </span>
                  <span>
                    <small>PPG</small>
                    <strong>{formatDecimal(uma.pointsPerGame)}</strong>
                  </span>
                  <span>
                    <small>WR</small>
                    <strong>{formatPercent(uma.winRate)}</strong>
                  </span>
                  <span>
                    <small>GP</small>
                    <strong>{uma.matches}</strong>
                  </span>
                </span>
              </li>
            )
          ))}
        </ol>
      )}
    </div>
  );
}

function BestUmaPortrait({ uma }: { uma: PlayerTopUmaSummary }) {
  const fallbackImageUrl = getFallbackUmaImageUrl(uma.umaId);
  const imageUrl = isHashedUmaAssetUrl(uma.imageUrl)
    ? fallbackImageUrl
    : uma.imageUrl ?? fallbackImageUrl;

  return (
    <span className="best-uma-portrait" aria-hidden="true">
      <UmaImage imageUrl={imageUrl} name={uma.name} />
    </span>
  );
}

function UmaImage({
  imageUrl,
  name,
  loading = 'lazy'
}: {
  imageUrl: string | undefined;
  name: string;
  loading?: 'eager' | 'lazy';
}) {
  const [hasImageError, setHasImageError] = useState(false);
  const shouldShowImage = imageUrl !== undefined && !hasImageError;

  useEffect(() => {
    setHasImageError(false);
  }, [imageUrl]);

  return shouldShowImage ? (
    <img
      src={imageUrl}
      alt=""
      loading={loading}
      onError={() => {
        setHasImageError(true);
      }}
    />
  ) : (
    <span>{getUmaInitials(name)}</span>
  );
}

function getFallbackUmaImageUrl(umaId: string): string | undefined {
  return getUmaPortraitUrl(umaId);
}

function RecentMatchesList({
  recentMatches,
  playerName,
  emptyMessage
}: {
  recentMatches?: PlayerProfileSummary['recentMatches'];
  playerName: string;
  emptyMessage?: string;
}) {
  const matches = recentMatches?.slice(0, RECENT_HISTORY_DISPLAY_MATCHES) ?? [];

  return (
    <section
      className="recent-matches"
      aria-label={`${playerName} recent ranked matches`}
      title={`Last ${RECENT_HISTORY_DISPLAY_MATCHES} ranked match-history entries for the selected stat scope.`}
    >
      <p>Recent Matches</p>
      {matches.length === 0 ? (
        <span className="section-message">{emptyMessage ?? 'No recent match history found.'}</span>
      ) : (
        <ol>
          {matches.map((match) => (
            <li key={match.matchId}>
              <span className={`recent-result ${getRecentResultTone(match)}`}>
                {formatRecentResult(match)}
              </span>
              <a
                href={`https://drafter.uma.guide/matches/${encodeURIComponent(match.matchId)}`}
                target="_blank"
                rel="noreferrer"
                className="recent-match-code"
                title="Open match history"
              >
                {match.matchId}
              </a>
              <span className="recent-uma" title={match.umaName}>{match.umaName}</span>
              <span className="recent-points">
                {match.pointsScored} pts{match.isMvp ? ' - MVP' : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function getRecentResultTone(match: PlayerRecentMatchSummary): string {
  if (match.verificationState !== 'confirmed') {
    return 'pending';
  }

  if (match.isWinner === true) {
    return 'win';
  }

  if (match.isWinner === false) {
    return 'loss';
  }

  return 'pending';
}

function formatRecentResult(match: PlayerRecentMatchSummary): string {
  if (match.verificationState !== 'confirmed') {
    return 'Pending';
  }

  if (match.isWinner === true) {
    return 'W';
  }

  if (match.isWinner === false) {
    return 'L';
  }

  return '-';
}

function getTeamGroups(roster: PrematchRoster | undefined): PrematchTeam[] {
  if (roster === undefined) {
    return [];
  }

  if (roster.teams !== undefined) {
    return TEAM_IDS.map((teamId) => roster.teams?.[teamId]).filter(
      (team): team is PrematchTeam => team !== undefined
    );
  }

  return [
    {
      id: 'team1',
      players: roster.players
    }
  ];
}

function getRosterPlayersForHitScope(roster: PrematchRoster, hitScope: UmaCatalogHitScope): PrematchPlayer[] {
  if (hitScope === 'all') {
    return roster.players;
  }

  return getDraftRosterPlayersForTeam(roster, hitScope);
}

function getHitScopeLabel(hitScope: UmaCatalogHitScope): string {
  if (hitScope === 'all') {
    return 'total';
  }

  return hitScope === 'team1' ? 'Team 1' : 'Team 2';
}

function getDraftRosterPlayersForTeam(
  roster: PrematchRoster | undefined,
  teamId: TeamId
): PrematchPlayer[] {
  const teamPlayers = roster?.teams?.[teamId]?.players;

  if (teamPlayers !== undefined) {
    return teamPlayers;
  }

  return (roster?.players ?? []).filter((player) =>
    player.finalTeam === teamId || player.team === teamId || player.initialTeam === teamId
  );
}

function getSelectedPlayerContext(
  teams: PrematchTeam[],
  selectedPlayerKey: string | undefined
): SelectedPlayerContext | undefined {
  if (selectedPlayerKey === undefined) {
    return undefined;
  }

  for (const team of teams) {
    const player = team.players.find((player) => getPlayerKey(player) === selectedPlayerKey);

    if (player !== undefined) {
      return { team, player };
    }
  }

  return undefined;
}

function getDisplayedProfileStats(
  profile: PlayerProfileSummary | undefined,
  statsScope: PlayerStatsScope
): PlayerProfileSummary | undefined {
  if (profile === undefined) {
    return undefined;
  }

  const stats = statsScope === 'allTime' ? profile.allTimeStats : profile.currentSeasonStats;

  if (stats === undefined) {
    return profile;
  }

  return {
    ...profile,
    ...stats,
    statsScope
  };
}

function getUmaCatalogOptions(
  profiles: Record<string, PlayerProfileSummary>,
  statsScope: PlayerStatsScope
): UmaCatalogOption[] {
  const catalog = new Map<string, UmaCatalogOption>();

  releaseOrder.forEach((entry, index) => {
    const umaId = entry.outfitId;

    catalog.set(umaId, {
      umaId,
      name: getUmaDisplayName(umaId, entry.name),
      imageUrl: getUmaPortraitUrl(umaId),
      order: index + 1
    });
  });

  for (const profile of Object.values(profiles)) {
    const displayedProfile = getDisplayedProfileStats(profile, statsScope);
    const umas = displayedProfile?.allUmas ?? profile.allUmas ?? [];

    for (const uma of umas) {
      const umaId = getUmaCatalogKey(uma.umaId, uma.name);
      const current = catalog.get(umaId);
      const profileImageUrl =
        uma.imageUrl !== undefined && !isHashedUmaAssetUrl(uma.imageUrl) ? uma.imageUrl : undefined;

      catalog.set(umaId, {
        umaId,
        name: getUmaDisplayName(umaId, uma.name),
        imageUrl: profileImageUrl ?? current?.imageUrl ?? getUmaPortraitUrl(umaId),
        order: current?.order
      });
    }
  }

  return Array.from(catalog.values());
}

function sortUmaCatalogOptions(
  catalog: UmaCatalogOption[],
  sortMode: UmaCatalogSortMode,
  historyCounts: Map<string, number>
): UmaCatalogOption[] {
  return [...catalog].sort((left, right) => {
    if (sortMode === 'lobbyHits') {
      const hitDelta = (historyCounts.get(right.umaId) ?? 0) - (historyCounts.get(left.umaId) ?? 0);

      if (hitDelta !== 0) {
        return hitDelta;
      }
    }

    if (sortMode === 'alphabetical') {
      return compareUmaByName(left, right);
    }

    return compareUmaByReleaseOrder(left, right);
  });
}

function compareUmaByReleaseOrder(left: UmaCatalogOption, right: UmaCatalogOption): number {
  const leftOrder = left.order ?? Number.NEGATIVE_INFINITY;
  const rightOrder = right.order ?? Number.NEGATIVE_INFINITY;
  const orderDelta = rightOrder - leftOrder;

  if (orderDelta !== 0) {
    return orderDelta;
  }

  return compareUmaByName(left, right);
}

function compareUmaByName(left: UmaCatalogOption, right: UmaCatalogOption): number {
  const nameDelta = left.name.localeCompare(right.name);

  if (nameDelta !== 0) {
    return nameDelta;
  }

  return left.umaId.localeCompare(right.umaId);
}

function getUmaCatalogKey(umaId: string | undefined, name: string): string {
  return umaId === undefined ? normalizeSearchText(name) : umaId;
}

function filterUmaCatalogOptions(
  catalog: UmaCatalogOption[],
  searchQuery: string
): UmaCatalogOption[] {
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (normalizedQuery.length === 0) {
    return catalog;
  }

  return catalog.filter((uma) => normalizeSearchText(uma.name).includes(normalizedQuery));
}

function getUmaHistoryCounts(
  catalog: UmaCatalogOption[],
  rosterPlayers: PrematchPlayer[],
  profiles: Record<string, PlayerProfileSummary>,
  statsScope: PlayerStatsScope
): Map<string, number> {
  return new Map(
    catalog.map((uma) => [
      uma.umaId,
      getUmaExperience(getUmaCatalogAction(uma), rosterPlayers, profiles, statsScope).length
    ])
  );
}

function getUmaCatalogAction(uma: UmaCatalogOption): DraftUmaAction {
  return {
    kind: 'pick',
    team: 'team1',
    name: uma.name,
    umaId: uma.umaId
  };
}

function getUmaExperience(
  action: DraftUmaAction,
  rosterPlayers: PrematchPlayer[],
  profiles: Record<string, PlayerProfileSummary>,
  statsScope: PlayerStatsScope
): UmaExperienceEntry[] {
  return rosterPlayers
    .map((player) => {
      const profile = profiles[player.discordId];
      const uma = findScopedUmaEntry(action, profile, statsScope);

      if (uma === undefined) {
        return null;
      }

      return {
        discordId: player.discordId,
        displayName: profile?.displayName ?? player.displayName,
        uma
      } satisfies UmaExperienceEntry;
    })
    .filter((entry): entry is UmaExperienceEntry => entry !== null)
    .sort((left, right) => {
      const matchesDelta = right.uma.matches - left.uma.matches;

      if (matchesDelta !== 0) {
        return matchesDelta;
      }

      return (right.uma.pointsPerGame ?? 0) - (left.uma.pointsPerGame ?? 0);
    });
}

function findScopedUmaEntry(
  action: DraftUmaAction,
  profile: PlayerProfileSummary | undefined,
  statsScope: PlayerStatsScope
): PlayerTopUmaSummary | undefined {
  const scopedStats = statsScope === 'allTime' ? profile?.allTimeStats : profile?.currentSeasonStats;
  const umas = scopedStats?.allUmas ?? profile?.allUmas ?? [];
  const nameMatch = findScopedUmaEntryByName(action, umas);

  if (action.umaId !== undefined) {
    const exactMatch = umas.find((uma) => uma.umaId === action.umaId);

    if (exactMatch !== undefined) {
      return exactMatch;
    }

    if (!isKnownUmaOutfitId(action.umaId)) {
      const normalizedUmaId = normalizeUmaOutfitId(action.umaId);
      const normalizedMatch = normalizedUmaId === action.umaId
        ? undefined
        : umas.find((uma) => uma.umaId === normalizedUmaId);

      if (normalizedMatch !== undefined) {
        return normalizedMatch;
      }
    }

    if (canUseUmaNameFallback(action)) {
      return nameMatch;
    }

    return undefined;
  }

  return nameMatch;
}

function findScopedUmaEntryByName(
  action: DraftUmaAction,
  umas: PlayerTopUmaSummary[]
): PlayerTopUmaSummary | undefined {
  const normalizedActionName = normalizeUmaNameForLookup(action.name);
  return umas.find((uma) => normalizeUmaNameForLookup(uma.name) === normalizedActionName);
}

function canUseUmaNameFallback(action: DraftUmaAction): boolean {
  if (action.umaId === undefined) {
    return true;
  }

  if (!isKnownUmaOutfitId(action.umaId)) {
    return true;
  }

  return (RELEASE_VARIANT_BY_OUTFIT_ID.get(action.umaId) ?? '').length === 0;
}

function getNotableBadges(profile: PlayerProfileSummary | undefined): NotableBadge[] {
  if (profile === undefined) {
    return [];
  }

  if (profile.statsPrivate === true) {
    return [
      {
        label: 'Private',
        tone: 'private',
        title: 'This player keeps ranked profile stats private.'
      }
    ];
  }

  const badges: NotableBadge[] = [];

  if (profile.rank !== undefined && profile.rank !== null) {
    if (profile.rank <= 10) {
      badges.push({
        label: 'Top 10',
        tone: 'rank',
        title: 'Current-season leaderboard rank is top 10.'
      });
    } else if (profile.rank <= 25) {
      badges.push({
        label: 'Top 25',
        tone: 'rank',
        title: 'Current-season leaderboard rank is top 25.'
      });
    }
  }

  if (
    profile.pointsPerGame !== undefined &&
    profile.pointsPerGame !== null &&
    profile.matches !== undefined &&
    profile.matches !== null &&
    profile.matches >= 5 &&
    profile.pointsPerGame >= 7
  ) {
    badges.push({
      label: 'Elite scoring',
      tone: 'scoring',
      title: 'Averages at least 7.0 points per ranked game with 5+ games in the selected stat scope.'
    });
  } else if (
    profile.pointsPerGame !== undefined &&
    profile.pointsPerGame !== null &&
    profile.matches !== undefined &&
    profile.matches !== null &&
    profile.matches >= 5 &&
    profile.pointsPerGame >= 6
  ) {
    badges.push({
      label: 'High scoring',
      tone: 'scoring',
      title: 'Averages at least 6.0 points per ranked game in the selected stat scope.'
    });
  }

  if (
    profile.matches !== undefined &&
    profile.matches !== null &&
    profile.matches >= 25 &&
    profile.pointsPerGame !== undefined &&
    profile.pointsPerGame !== null &&
    profile.pointsPerGame >= 5.5
  ) {
    badges.push({
      label: 'Established',
      tone: 'sample',
      title: `${profile.matches} ranked games while averaging ${formatDecimal(profile.pointsPerGame)} points per game in the selected stat scope.`
    });
  }

  if (
    profile.recentForm !== undefined &&
    profile.recentForm.matches >= 5 &&
    profile.recentForm.scoringRate !== null &&
    profile.recentForm.scoringRate >= 0.75
  ) {
    badges.push({
      label: 'Consistent',
      tone: 'sample',
      title: `Scored points in ${formatPercent(profile.recentForm.scoringRate)} of the last ${profile.recentForm.matches} confirmed ranked matches.`
    });
  }

  return badges;
}

function getTeamPartyVisuals(players: PrematchPlayer[]): Record<string, PartyVisual> {
  const partyCounts = new Map<string, number>();
  const orderedPartyIds: string[] = [];

  for (const player of players) {
    if (player.partyId === null || player.partyId === undefined) {
      continue;
    }

    if (!partyCounts.has(player.partyId)) {
      orderedPartyIds.push(player.partyId);
    }

    partyCounts.set(player.partyId, (partyCounts.get(player.partyId) ?? 0) + 1);
  }

  const visuals: Record<string, PartyVisual> = {};
  let visualIndex = 0;

  for (const partyId of orderedPartyIds) {
    const partySize = partyCounts.get(partyId) ?? 0;

    if (partySize < 2) {
      continue;
    }

    visuals[partyId] = {
      className: visualIndex % 2 === 0 ? 'party-accent-1' : 'party-accent-2',
      label: getPartyLabel(partySize),
      title: `Grouped party of ${partySize} players in this lobby.`
    };
    visualIndex += 1;
  }

  return visuals;
}

function getPlayerPartyVisual(
  player: PrematchPlayer,
  partyVisuals: Record<string, PartyVisual>
): PartyVisual | undefined {
  if (player.partyId === null || player.partyId === undefined) {
    return undefined;
  }

  return partyVisuals[player.partyId];
}

function getPartyLabel(partySize: number): string {
  if (partySize === 2) {
    return 'Duo';
  }

  if (partySize === 3) {
    return 'Trio';
  }

  return `Stack ${partySize}`;
}

function getPlayerRowClassName(partyVisual?: PartyVisual): string {
  const classes = ['player-row'];

  if (partyVisual !== undefined) {
    classes.push(partyVisual.className);
  }

  return classes.join(' ');
}

function isPrematchRoster(value: unknown): value is PrematchRoster {
  return (
    typeof value === 'object' &&
    value !== null &&
    'players' in value &&
    Array.isArray(value.players)
  );
}

function isDraftSnapshot(value: unknown): value is DraftSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'teams' in value &&
    typeof value.teams === 'object' &&
    value.teams !== null
  );
}

function isProfileSnapshot(value: unknown): value is PlayerProfileSummariesSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'profiles' in value &&
    'loadingDiscordIds' in value &&
    Array.isArray(value.loadingDiscordIds)
  );
}

function formatRank(profile: PlayerProfileSummary | undefined, isLoading: boolean): string {
  if (profile?.rank !== undefined && profile.rank !== null) {
    return `#${profile.rank}`;
  }

  return isLoading ? 'Loading profile' : 'Unranked';
}

function formatRecord(profile: PlayerProfileSummary | undefined): string {
  if (profile?.wins === undefined || profile.losses === undefined) {
    return '-';
  }

  if (profile.wins === null || profile.losses === null) {
    return '-';
  }

  return `${profile.wins}-${profile.losses}`;
}

function formatPercent(value: number | null | undefined): string {
  return value === undefined || value === null ? '-' : `${(value * 100).toFixed(0)}%`;
}

function formatDecimal(value: number | null | undefined): string {
  return value === undefined || value === null ? '-' : value.toFixed(1);
}

function formatNumber(value: number | null | undefined): string {
  return value === undefined || value === null ? '-' : value.toLocaleString();
}

function formatDraftPhase(phase: string): string {
  return phase
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function formatDraftMapTitle(map: DraftTeamSnapshot['maps'][number]): string {
  const details = formatDraftMapDetails(map);

  return details === undefined ? map.name : `${map.name}${DRAFT_DETAIL_SEPARATOR}${details}`;
}

function formatDraftMapDetails(map: DraftTeamSnapshot['maps'][number]): string | undefined {
  if (map.details === undefined) {
    return undefined;
  }

  const details = map.details
    .replace(/\s*[-–—]\s*[x×✕✖]\s*$/i, '')
    .replace(/\s*[x×✕✖]\s*$/i, '')
    .split(/\s*(?:[-\u2013\u2014]|\u2022)\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(DRAFT_DETAIL_SEPARATOR);

  return details.length === 0 ? undefined : details;
}

function formatTiebreakerMap(map: NonNullable<DraftSnapshot['tiebreakerMap']>): string {
  const parsed = parseTiebreakerMapParts(map);

  if (parsed === undefined) {
    return map.details === undefined ? map.name : `${map.name} (${map.details})`;
  }

  const details = parsed.details
    .map(formatTiebreakerDetailToken)
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(DRAFT_DETAIL_SEPARATOR);

  if (details.length === 0) {
    return parsed.name;
  }

  return `${parsed.name}${DRAFT_DETAIL_SEPARATOR}${details}`;
}

function parseTiebreakerMapParts(
  map: NonNullable<DraftSnapshot['tiebreakerMap']>
): { name: string; details: string[] } | undefined {
  const combinedText = (map.details === undefined ? map.name : `${map.name} - ${map.details}`)
    .replace(/\u00a0/g, ' ')
    .trim();
  const compactTextMatch = /^(.+?)\s*\((\d{3,4})m?\s+([^)]+)\)\s*([A-Za-z\s]+)$/.exec(combinedText);

  if (compactTextMatch !== null) {
    const [, name, distance, surface, trailingDetails] = compactTextMatch;

    if (name !== undefined && distance !== undefined && surface !== undefined) {
      return {
        name: name.trim(),
        details: [
          distance,
          surface.trim(),
          ...splitCompactTiebreakerDetails(trailingDetails ?? '')
        ]
      };
    }
  }

  const [rawName, ...rawDetails] = combinedText
    .split(/\s*(?:[-\u2013\u2014]|\u2022)\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (rawName === undefined || rawDetails.length === 0) {
    return undefined;
  }

  return {
    name: rawName,
    details: rawDetails
  };
}

function formatTiebreakerDetailToken(value: string): string {
  return value.replace(/^(\d{3,4})m$/i, '$1');
}

function splitCompactTiebreakerDetails(value: string): string[] {
  return Array.from(
    value.matchAll(/Right|Left|Straight|Inner|Outer|Spring|Summer|Fall|Winter|Firm|Good|Soft|Heavy|Sunny|Cloudy|Rainy|Snowy/gi),
    ([token]) => token
  );
}

function formatDraftUmaKind(kind: DraftUmaAction['kind']): string {
  switch (kind) {
    case 'ban':
      return 'Banned';
    case 'veto':
      return 'Vetoed';
    case 'pick':
      return 'Picked';
  }
}

function formatTeamName(team: DraftTeamSnapshot | undefined): string {
  return team?.name ?? team?.id ?? 'Unknown team';
}

function formatUmaLine(uma: PlayerTopUmaSummary | undefined): string {
  if (uma === undefined) {
    return 'No data';
  }

  return `${uma.matches} GP - ${formatDecimal(uma.pointsPerGame)} PPG`;
}

function getUmaInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function normalizeUmaNameForLookup(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatBestUmaLine(uma: PlayerTopUmaSummary | undefined): string {
  if (uma === undefined) {
    return 'No data';
  }

  if (uma.performanceScore === undefined) {
    return `${formatDecimal(uma.pointsPerGame)} PPG - ${uma.matches} GP`;
  }

  return `${formatNumber(uma.performanceScore)} score - ${formatSampleConfidence(getSampleConfidence(uma.matches))}`;
}

function formatRecordDetail(profile: PlayerProfileSummary): string {
  const record = formatRecord(profile);

  return record === '-' ? 'Record unknown' : `${record} W-L`;
}

function formatSampleDetail(profile: PlayerProfileSummary): string {
  const matches = formatNumber(profile.matches);
  const record = formatRecordDetail(profile);

  return matches === '-' ? record : `${matches} GP - ${record}`;
}

function formatScoringValue(pointsPerGame: number | null | undefined): string {
  const formattedScoring = formatDecimal(pointsPerGame);

  return formattedScoring === '-' ? '-' : `${formattedScoring} PPG`;
}

function formatStatsScopeShortLabel(statsScope: PlayerStatsScope): string {
  return statsScope === 'currentSeason' ? 'Seasonal' : 'All-time';
}

function formatWinRateDetail(winRate: number | null | undefined): string {
  const formattedWinRate = formatPercent(winRate);

  return formattedWinRate === '-' ? 'Win rate unknown' : `${formattedWinRate} win`;
}

function getSampleConfidence(matches: number | null | undefined): SampleConfidence {
  if (matches === undefined || matches === null || matches < 10) {
    return 'small';
  }

  if (matches < 25) {
    return 'steady';
  }

  return 'proven';
}

function formatSampleConfidence(confidence: SampleConfidence): string {
  switch (confidence) {
    case 'proven':
      return 'Established';
    case 'steady':
      return 'Steady';
    case 'small':
      return 'Small';
  }
}

function getUmaBadges(uma: PlayerTopUmaSummary): UmaBadge[] {
  const badges: UmaBadge[] = [];
  const confidence = getSampleConfidence(uma.matches);

  if (uma.pointsPerGame !== null && uma.pointsPerGame >= 7) {
    badges.push({
      label: 'Scoring',
      value: 'Elite',
      tone: 'scoring',
      title: 'Averages at least 7.0 points per ranked game on this Uma.'
    });
  } else if (uma.pointsPerGame !== null && uma.pointsPerGame >= 6.5) {
    badges.push({
      label: 'Scoring',
      value: 'High',
      tone: 'scoring',
      title: 'Averages at least 6.5 points per ranked game on this Uma.'
    });
  } else if (uma.pointsPerGame !== null && uma.pointsPerGame >= 5.5) {
    badges.push({
      label: 'Scoring',
      value: 'Solid',
      tone: 'scoring',
      title: 'Averages at least 5.5 points per ranked game on this Uma.'
    });
  }

  if (uma.winRate !== null && uma.winRate >= 0.7 && uma.matches >= 10) {
    badges.push({
      label: 'Wins',
      value: '70%+',
      tone: 'winrate',
      title: 'At least 10 ranked games and a 70% or higher win rate on this Uma.'
    });
  } else if (uma.winRate !== null && uma.winRate >= 0.65 && uma.matches >= 10) {
    badges.push({
      label: 'Wins',
      value: '65%+',
      tone: 'winrate',
      title: 'At least 10 ranked games and a 65% or higher win rate on this Uma.'
    });
  }

  if (confidence === 'small') {
    badges.push({
      label: 'Sample',
      value: 'Small',
      tone: 'caution',
      title: 'Fewer than 10 ranked games on this Uma. Treat the result as a hint, not a conclusion.'
    });
  } else if (confidence === 'proven') {
    badges.push({
      label: 'Sample',
      value: 'Established',
      tone: 'sample',
      title: 'At least 25 ranked games on this Uma.'
    });
  } else {
    badges.push({
      label: 'Sample',
      value: 'Steady',
      tone: 'sample',
      title: 'At least 10 ranked games on this Uma.'
    });
  }

  return badges.slice(0, 3);
}

function getRefreshCooldownMs(updatedAt: number | undefined, now: number): number {
  if (updatedAt === undefined) {
    return 0;
  }

  return Math.max(updatedAt + MANUAL_PROFILE_REFRESH_COOLDOWN_MS - now, 0);
}

function getClockRefreshDelayMs(
  snapshot: PlayerProfileSummariesSnapshot | undefined,
  now: number
): number {
  if (snapshot === undefined) {
    return IDLE_CLOCK_REFRESH_MS;
  }

  if (snapshot.loadingDiscordIds.length > 0) {
    return ACTIVE_CLOCK_REFRESH_MS;
  }

  return getRefreshCooldownMs(snapshot.updatedAt, now) > 0
    ? ACTIVE_CLOCK_REFRESH_MS
    : IDLE_CLOCK_REFRESH_MS;
}

function getProfileSnapshotStatus(
  snapshot: PlayerProfileSummariesSnapshot | undefined,
  loadingProfiles: number,
  now: number
): string | undefined {
  if (loadingProfiles > 0) {
    return `Refreshing ${loadingProfiles} profile${loadingProfiles === 1 ? '' : 's'}`;
  }

  if (snapshot === undefined) {
    return undefined;
  }

  return `Profile data updated ${formatRelativeAge(snapshot.updatedAt, now)}`;
}

function getProfileDataStatus(
  discordId: string | undefined,
  profile: PlayerProfileSummary | undefined,
  isProfileLoading: boolean,
  now: number
): { label: string; tone: 'fresh' | 'loading' | 'warning' | 'muted' } {
  if (discordId === undefined) {
    return {
      label: 'Profile link unavailable from room page',
      tone: 'muted'
    };
  }

  if (isProfileLoading) {
    return {
      label: 'Refreshing profile data',
      tone: 'loading'
    };
  }

  if (profile === undefined) {
    return {
      label: 'Profile data not loaded yet',
      tone: 'muted'
    };
  }

  if (profile.statsPrivate === true) {
    return {
      label: `Stats private - checked ${formatRelativeAge(profile.fetchedAt, now)}`,
      tone: 'warning'
    };
  }

  if (profile.error !== undefined) {
    return {
      label: `Profile unavailable - checked ${formatRelativeAge(profile.fetchedAt, now)}`,
      tone: 'warning'
    };
  }

  return {
    label: `Profile data current - updated ${formatRelativeAge(profile.fetchedAt, now)}`,
    tone: 'fresh'
  };
}

function formatRelativeAge(timestamp: number, now: number): string {
  const ageSeconds = Math.max(Math.floor((now - timestamp) / 1000), 0);

  if (ageSeconds < 10) {
    return 'just now';
  }

  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`;
  }

  const ageMinutes = Math.floor(ageSeconds / 60);

  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`;
  }

  const ageHours = Math.floor(ageMinutes / 60);

  return `${ageHours}h ago`;
}

function getPlayerNote(
  profile: PlayerProfileSummary | undefined,
  discordId: string | undefined
): string | undefined {
  if (discordId === undefined) {
    return 'Open their Uma profile once available to scout detailed stats.';
  }

  if (profile === undefined) {
    return 'Profile data has not loaded yet.';
  }

  if (profile.statsPrivate === true) {
    return 'Stats are private.';
  }

  return profile.error;
}

function getStatsMessage(
  profile: PlayerProfileSummary | undefined,
  isProfileLoading: boolean,
  discordId: string | undefined
): string | undefined {
  if (isProfileLoading && discordId !== undefined) {
    return 'Loading ranked Uma stats.';
  }

  if (discordId === undefined) {
    return 'Profile lookup is unavailable from this room page.';
  }

  if (profile?.statsPrivate === true) {
    return 'Ranked Uma stats are private.';
  }

  if (profile?.error !== undefined) {
    return 'Unable to load ranked Uma stats.';
  }

  if (profile === undefined) {
    return 'Profile data has not loaded yet.';
  }

  return undefined;
}

async function getStoredStatsScope(): Promise<PlayerStatsScope> {
  const values = await browser.storage.local.get(STATS_SCOPE_STORAGE_KEY);
  const storedStatsScope = values[STATS_SCOPE_STORAGE_KEY];

  return storedStatsScope === 'allTime' || storedStatsScope === 'currentSeason'
    ? storedStatsScope
    : 'currentSeason';
}
