import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './umas.css';
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
  summarizeUmaExperience,
  sortUmaCatalogOptions
} from './umaCatalog';

export const DEFAULT_UMA_CATALOG_SORT_OPTION: UmaCatalogSortOption = { value: 'lobbyHits', label: 'Most played' };

export const UMA_CATALOG_SORT_OPTIONS: UmaCatalogSortOption[] = [
  DEFAULT_UMA_CATALOG_SORT_OPTION,
  { value: 'releaseOrder', label: 'Release' },
  { value: 'alphabetical', label: 'A–Z' }
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
  const sceneRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) return;
    let pendingFrame: number | undefined;
    const fitScene = () => {
      if (scene.getClientRects().length === 0) return;
      const shell = scene.closest('.app-shell');
      const bottomPadding = shell === null ? 0 : parseFloat(getComputedStyle(shell).paddingBottom);
      const top = scene.getBoundingClientRect().top + window.scrollY;
      const height = `${Math.max(0, window.innerHeight - top - bottomPadding)}px`;
      if (scene.style.height !== height) scene.style.height = height;
    };
    const observer = new ResizeObserver(() => {
      if (pendingFrame !== undefined) return;
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = undefined;
        fitScene();
      });
    });
    for (let parent = scene.parentElement; parent !== null; parent = parent.parentElement) {
      observer.observe(parent);
      for (const sibling of parent.children) observer.observe(sibling);
    }
    window.addEventListener('resize', fitScene);
    fitScene();
    return () => {
      observer.disconnect();
      if (pendingFrame !== undefined) window.cancelAnimationFrame(pendingFrame);
      window.removeEventListener('resize', fitScene);
    };
  }, []);

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
    <section ref={sceneRef} className="uma-planner-scene" aria-label="Uma planner">
      <div className="uma-planner-layout">
        <section className="uma-catalog-panel" aria-label="Uma catalog">
          <div className="uma-catalog-toolbar">
            <div className="uma-catalog-heading">
              <strong>Uma Catalog</strong>
              <span>
                {filteredCatalog.length} {searchQuery.trim().length === 0 ? 'Umas' : 'matches'}
              </span>
            </div>
            <div className="uma-catalog-controls">
              <label className="uma-search" aria-label="Search Umas">
                <input
                  type="search"
                  aria-label="Search Umas"
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
                      aria-pressed={option.value === hitScope}
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
        <UmaPlanningPanel
          selectedUma={selectedUma}
          roster={roster}
          profiles={profiles}
          statsScope={statsScope}
        />
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
  return (
    <div className="uma-sort-toggle" role="group" aria-label="Sort Uma catalog">
      {UMA_CATALOG_SORT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
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
      onClick={() => {
        onSelect(uma.umaId);
      }}
    >
      <span className="uma-catalog-portrait">
        <UmaImage imageUrl={uma.imageUrl} name={uma.name} />
        {historyCount > 0 ? (
          <span className="uma-catalog-count" aria-label={`${historyCount} ${historyCount === 1 ? 'player' : 'players'} played`}>
            {historyCount}
          </span>
        ) : null}
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
  const experience = getUmaExperience(action, roster.players, profiles, statsScope);
  const summary = summarizeUmaExperience(experience);
  const scopeLabel = formatStatsScopeShortLabel(statsScope);

  return (
    <section className="uma-planning-panel" aria-label={`${selectedUma.name} lobby history`}>
      <header className="uma-planning-heading">
        <span className="uma-planning-portrait">
          <UmaImage imageUrl={selectedUma.imageUrl} name={selectedUma.name} loading="eager" />
        </span>
        <div className="uma-planning-title">
          <h3>{selectedUma.name}</h3>
          <p>
            {experience.length} {experience.length === 1 ? 'player' : 'players'} with {scopeLabel} history
          </p>
        </div>
      </header>
      <div className="uma-planning-summary" aria-label={`${selectedUma.name} lobby stats`}>
        <span><small>Lobby games</small><strong>{summary.games}</strong></span>
        <span><small>Lobby WR</small><strong>{formatPercent(summary.winRate)}</strong></span>
        <span><small>Lobby PPG</small><strong>{formatDecimal(summary.pointsPerGame)}</strong></span>
      </div>

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
      <table className="uma-planning-table" aria-label={`${team?.name ?? (fallbackTeamId === 'team1' ? 'Team 1' : 'Team 2')} Uma stats`}>
        <thead><tr><th scope="col">Player</th><th scope="col">GP</th><th scope="col">WR</th><th scope="col">PPG</th></tr></thead>
        <tbody>
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
        </tbody>
      </table>
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
      <tr className="uma-planning-player empty">
        <th scope="row">Open slot {slotNumber}</th>
        <td>—</td><td>—</td><td>—</td>
      </tr>
    );
  }

  const uma = findScopedUmaEntry(action, profile, statsScope);

  return (
    <tr className={uma === undefined ? 'uma-planning-player no-history' : 'uma-planning-player'}>
      <th scope="row">{profile?.displayName ?? player.displayName}</th>
      {uma === undefined ? (
        <td colSpan={3} className="uma-planning-unavailable">{missingUmaHistoryLabel(profile, statsScope)}</td>
      ) : (
        <>
          <td>{uma.matches}</td>
          <td>{formatPercent(uma.winRate)}</td>
          <td>{formatDecimal(uma.pointsPerGame)}</td>
        </>
      )}
    </tr>
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
