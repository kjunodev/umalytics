import { useEffect, useMemo, useState } from 'react';
import type { DraftUmaAction, PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchRoster, PrematchTeam, TeamId } from '@umalytics/shared';
import { missingUmaHistoryLabel } from '../../profiles/profileAvailability';
import { getTeamGroups } from '../../room/rosterDisplay';
import { UmaImage } from '../common/UmaImage';
import { formatDecimal, formatPercent, formatStatsScopeShortLabel } from '../common/format';
import { TEAM_IDS, TEAM_SLOT_COUNT, getDraftRosterPlayersForTeam, getDraftSlots, getPlayerKey } from '../common/roster';
import type { UmaCatalogHitScope, UmaCatalogHitScopeOption, UmaCatalogOption, UmaCatalogSortMode, UmaCatalogSortOption } from './umaCatalog';
import {
  filterUmaCatalogOptions,
  findScopedUmaEntry,
  getUmaCatalogAction,
  getUmaCatalogOptions,
  getUmaExperience,
  getUmaHistoryCounts,
  sortUmaCatalogOptions
} from './umaCatalog';

export const DEFAULT_UMA_CATALOG_SORT_OPTION: UmaCatalogSortOption = { value: 'lobbyHits', label: 'Total hits' };

export const UMA_CATALOG_SORT_OPTIONS: UmaCatalogSortOption[] = [
  DEFAULT_UMA_CATALOG_SORT_OPTION,
  { value: 'releaseOrder', label: 'Release order' },
  { value: 'alphabetical', label: 'Alphabetical' }
];

export const UMA_CATALOG_HIT_SCOPE_OPTIONS: UmaCatalogHitScopeOption[] = [
  { value: 'all', label: 'All' },
  { value: 'team1', label: 'Team 1' },
  { value: 'team2', label: 'Team 2' }
];

export function UmaPlannerScene({
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
    () => Array.from(historyCounts.values()).reduce((total, count) => total + count, 0),
    [historyCounts]
  );
  const hitScopeLabel = getHitScopeLabel(hitScope);

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

export function UmaCatalogSortMenu({
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

export function UmaCatalogButton({
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

export function UmaPlanningPanel({
  selectedUma,
  roster,
  profiles,
  statsScope
}: {
  selectedUma: UmaCatalogOption | undefined;
  roster: PrematchRoster;
  profiles: Record<string, PlayerProfileSummary>;
  statsScope: PlayerStatsScope;
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

    </section>
  );
}

export function UmaPlanningTeamPanel({
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

export function UmaPlanningPlayerSlot({
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
        <span>{missingUmaHistoryLabel(profile, statsScope)}</span>
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

export function getRosterPlayersForHitScope(roster: PrematchRoster, hitScope: UmaCatalogHitScope): PrematchPlayer[] {
  if (hitScope === 'all') {
    return roster.players;
  }

  return getDraftRosterPlayersForTeam(roster, hitScope);
}

export function getHitScopeLabel(hitScope: UmaCatalogHitScope): string {
  if (hitScope === 'all') {
    return 'All';
  }

  return hitScope === 'team1' ? 'Team 1' : 'Team 2';
}
