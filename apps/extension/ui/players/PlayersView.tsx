import { useEffect, useRef, useState } from 'react';
import type { PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchRoster } from '@umalytics/shared';
import './players.css';
import { loadExplorerProfiles, loadSeasonLeaderboard, searchPlayers } from '../../explorer/explorerClient';
import { lookupPlayer } from '../../explorer/explorerData';
import type { PlayerSearchResult } from '../../explorer/explorerTypes';
import type { SeasonLeaderboard, SeasonLeaderboardEntry } from '../../profiles/playerProfileApi';
import { getRecentPlayers, setRecentPlayers, type RecentPlayerEntry } from '../../storage/playersRecentStorage';
import { formatNumber } from '../common/format';
import { PlayerDrawer } from '../player/PlayerDrawer';
import {
  classifyPlayerQuery,
  filterLeaderboardEntries,
  findRosterTeamForPlayer,
  formatLeaderboardGames,
  formatLeaderboardRecord,
  formatLeaderboardWinRate,
  leaderboardEntryToPlayer,
  pushRecentPlayer,
  rankTintClass,
  shouldLoadLeaderboard,
  sortLeaderboardEntries,
  type LeaderboardSortKey
} from './playersData';

const LB_COLUMNS: { key: LeaderboardSortKey | null; label: string }[] = [
  { key: 'rank', label: 'Rank' },
  { key: null, label: 'Player' },
  { key: 'rating', label: 'Rating' },
  { key: null, label: 'W-L' },
  { key: 'win', label: 'Win' },
  { key: 'games', label: 'Games' }
];

interface LeaderboardState {
  data?: SeasonLeaderboard;
  loading: boolean;
  error?: string;
  retryAt?: number;
  fetchedAt?: number;
}

interface DirectorySearchState {
  term?: string;
  page: number;
  loading: boolean;
  error?: string;
  retryAt?: number;
  results?: PlayerSearchResult;
}

function getErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'Unable to complete the request.';
}

function getRetryAt(caught: unknown): number | undefined {
  const value = (caught as { retryAt?: unknown } | null)?.retryAt;
  return typeof value === 'number' ? value : undefined;
}

// A single-player counterpart to ExplorerViews' useProfiles: the drawer only
// ever needs the currently opened player's stats. `active` keeps this from
// starting a profile load while the Players view is hidden.
function usePlayerProfile(player: PrematchPlayer | undefined, statsScope: PlayerStatsScope, active: boolean) {
  const [profile, setProfile] = useState<PlayerProfileSummary | undefined>();
  const [loading, setLoading] = useState(false);
  const key = player === undefined ? '' : `${player.discordId}:${statsScope}`;
  const previousKey = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    if (previousKey.current !== key) setProfile(undefined);
    previousKey.current = key;
    if (player === undefined || !active) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    void loadExplorerProfiles([player], statsScope, next => {
      if (!controller.signal.aborted) setProfile(next[player.discordId]);
    }, controller.signal)
      .then(next => { if (!controller.signal.aborted) setProfile(next[player.discordId]); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Re-run only when the identity+scope key or activation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
  return { profile, loading };
}

export function PlayersView({ roster, statsScope, active }: { roster: PrematchRoster | undefined; statsScope: PlayerStatsScope; active: boolean }) {
  const [leaderboardState, setLeaderboardState] = useState<LeaderboardState>({ loading: false });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<LeaderboardSortKey>('rank');
  const [recent, setRecent] = useState<RecentPlayerEntry[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PrematchPlayer | undefined>();
  const [searchState, setSearchState] = useState<DirectorySearchState>({ page: 1, loading: false });
  const [now, setNow] = useState(Date.now());
  const searchRequest = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    if (!shouldLoadLeaderboard(active, leaderboardState.fetchedAt, Date.now())) return undefined;
    const controller = new AbortController();
    // Only show the skeleton before the first successful load; a background
    // refresh on reactivation keeps the existing rows visible while it runs.
    const showLoading = leaderboardState.data === undefined;
    setLeaderboardState(previous => ({ ...previous, loading: showLoading, error: showLoading ? undefined : previous.error }));
    void loadSeasonLeaderboard(controller.signal)
      .then(data => { if (!controller.signal.aborted) setLeaderboardState({ data, loading: false, fetchedAt: Date.now() }); })
      .catch(caught => {
        if (controller.signal.aborted) return;
        setLeaderboardState(previous => ({
          data: previous.data, fetchedAt: previous.fetchedAt, loading: false,
          error: getErrorMessage(caught), retryAt: getRetryAt(caught)
        }));
      });
    return () => controller.abort();
    // Re-run only on an activation transition or an explicit retry; the
    // staleness check reads leaderboardState from this render's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, attempt]);

  useEffect(() => {
    let cancelled = false;
    void getRecentPlayers().then(stored => { if (!cancelled) setRecent(stored); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    searchRequest.current?.abort();
    setSearchState({ page: 1, loading: false });
  }, [query]);

  useEffect(() => {
    const pendingRetry = [leaderboardState.retryAt, searchState.retryAt].some(value => value !== undefined && value > now);
    if (!pendingRetry) return undefined;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [leaderboardState.retryAt, searchState.retryAt, now]);

  useEffect(() => () => searchRequest.current?.abort(), []);

  const openPlayer = (player: PrematchPlayer) => {
    setSelectedPlayer(player);
    setRecent(previous => {
      const next = pushRecentPlayer(previous, { discordId: player.discordId, displayName: player.displayName });
      void setRecentPlayers(next);
      return next;
    });
  };

  const runDirectorySearch = (term: string, page = 1) => {
    if (!active) return;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearchState({ term, page, loading: true });
    void searchPlayers(term, page, controller.signal)
      .then(found => { if (!controller.signal.aborted) setSearchState({ term, page, loading: false, results: found }); })
      .catch(caught => {
        if (controller.signal.aborted) return;
        setSearchState({ term, page, loading: false, error: getErrorMessage(caught), retryAt: getRetryAt(caught) });
      });
  };

  const { profile: selectedProfile, loading: selectedProfileLoading } = usePlayerProfile(selectedPlayer, statsScope, active);
  const rosterTeam = selectedPlayer === undefined ? undefined : findRosterTeamForPlayer(roster, selectedPlayer.discordId);

  const classification = classifyPlayerQuery(query);
  const entries = leaderboardState.data?.entries ?? [];
  const filteredEntries = classification.mode === 'filter' ? filterLeaderboardEntries(entries, classification.text) : [];
  const sortedEntries = classification.mode === 'filter' ? sortLeaderboardEntries(filteredEntries, sortKey) : [];
  const countLabel = classification.mode === 'filter' && classification.text.trim().length > 0
    ? `${sortedEntries.length} of ${entries.length} ranked players`
    : `${entries.length} ranked players`;

  return (
    <section className="players-view" aria-label="Players">
      <div className="players-toolbar">
        <label className="players-search">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12.2 12.2L16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.currentTarget.value)}
            placeholder="Search the leaderboard, or paste a profile URL or Discord ID"
            aria-label="Search players"
            spellCheck={false}
            maxLength={300}
          />
        </label>
        {recent.length > 0 && (
          <div className="players-recent" aria-label="Recently viewed">
            <span className="lbl">Recent</span>
            {recent.map(entry => (
              <button
                key={entry.discordId}
                type="button"
                className="players-recent-chip"
                onClick={() => openPlayer(lookupPlayer(entry.discordId, entry.displayName))}
              >
                {entry.displayName}
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="players-board" aria-label="Season leaderboard">
        <div className="players-board-head">
          <h2>Season leaderboard</h2>
          <span className="players-count">{countLabel}</span>
          <div className="players-board-head-spacer" />
          {leaderboardState.data?.activeSeasonId !== undefined && (
            <span className="players-season">Season {leaderboardState.data.activeSeasonId}</span>
          )}
        </div>

        <div className="players-cols" role="row">
          {LB_COLUMNS.map(column => column.key === null ? (
            <span key={column.label} className="players-th players-th-static">{column.label}</span>
          ) : (
            <button
              key={column.label}
              type="button"
              className={sortKey === column.key ? 'players-th on' : 'players-th'}
              onClick={() => setSortKey(column.key as LeaderboardSortKey)}
            >
              {column.label}{sortKey === column.key ? (column.key === 'rank' ? ' ▴' : ' ▾') : ''}
            </button>
          ))}
        </div>

        <div className="players-rows" role="rowgroup">
          {classification.mode === 'lookup' ? (
            <div className="players-lookup">
              <span className="lbl">Profile lookup</span>
              <div>That looks like a Discord ID or profile URL. Players outside the leaderboard can still be opened.</div>
              <button
                type="button"
                className="players-open-button"
                onClick={() => openPlayer(lookupPlayer(classification.id))}
              >
                Open profile
              </button>
            </div>
          ) : leaderboardState.loading ? (
            Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="players-row-skel" aria-hidden="true">
                <span className="card-skel" style={{ width: 30, height: 18 }} />
                <span className="card-skel" style={{ height: 14, width: '60%' }} />
                <span className="card-skel" style={{ height: 14 }} />
                <span className="card-skel" style={{ height: 14 }} />
                <span className="card-skel" style={{ height: 14 }} />
                <span className="card-skel" style={{ height: 14 }} />
              </div>
            ))
          ) : leaderboardState.error !== undefined ? (
            <ApiErrorNotice
              error={leaderboardState.error}
              retryAt={leaderboardState.retryAt}
              now={now}
              onRetry={() => setAttempt(value => value + 1)}
            />
          ) : sortedEntries.length === 0 && classification.text.trim().length > 0 ? (
            <DirectorySearchPanel
              term={classification.text}
              state={searchState}
              now={now}
              onSearch={() => runDirectorySearch(classification.text)}
              onRetry={() => runDirectorySearch(classification.text, searchState.page)}
              onPage={page => runDirectorySearch(classification.text, page)}
              onOpen={openPlayer}
            />
          ) : (
            sortedEntries.map(entry => (
              <LeaderboardRow
                key={entry.userId}
                entry={entry}
                selected={selectedPlayer?.discordId === entry.userId}
                onOpen={() => openPlayer(leaderboardEntryToPlayer(entry))}
              />
            ))
          )}
        </div>
      </section>

      {selectedPlayer !== undefined && (
        <PlayerDrawer
          player={selectedPlayer}
          profile={selectedProfile}
          onClose={() => setSelectedPlayer(undefined)}
          context={{
            team: rosterTeam,
            statsScope,
            isProfileLoading: selectedProfileLoading,
            now: Date.now(),
            inLobby: rosterTeam !== undefined
          }}
        />
      )}
    </section>
  );
}

function LeaderboardRow({ entry, selected, onOpen }: { entry: SeasonLeaderboardEntry; selected: boolean; onOpen: () => void }) {
  const tint = rankTintClass(entry.rank);
  return (
    <button
      type="button"
      className={selected ? 'players-row sel' : 'players-row'}
      onClick={onOpen}
      aria-label={`Open ${entry.displayName ?? entry.userId}, rank ${entry.rank}`}
    >
      <span className={tint === undefined ? 'players-rank' : `players-rank ${tint}`}>#{entry.rank}</span>
      <span className="players-name">{entry.displayName ?? entry.userId}</span>
      <span className="players-num">{formatNumber(entry.rating ?? null)}</span>
      <span className="players-num players-num-muted">{formatLeaderboardRecord(entry)}</span>
      <span className="players-num">{formatLeaderboardWinRate(entry)}</span>
      <span className="players-num players-num-muted">{formatLeaderboardGames(entry)}</span>
    </button>
  );
}

function ApiErrorNotice({ error, retryAt, now, onRetry }: { error: string; retryAt?: number; now: number; onRetry: () => void }) {
  if (retryAt !== undefined && retryAt > now) {
    const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
    return <p className="api-retry-notice" role="status">{error} Automatic retry in approximately {seconds}s.</p>;
  }
  return (
    <p className="players-error" role="alert">
      {error} <button type="button" onClick={onRetry}>Retry</button>
    </p>
  );
}

function DirectorySearchPanel({ term, state, now, onSearch, onRetry, onPage, onOpen }: {
  term: string;
  state: DirectorySearchState;
  now: number;
  onSearch: () => void;
  onRetry: () => void;
  onPage: (page: number) => void;
  onOpen: (player: PrematchPlayer) => void;
}) {
  if (state.results === undefined && !state.loading && state.error === undefined) {
    return (
      <div className="players-empty">
        <strong>No ranked player matches &ldquo;{term}&rdquo;</strong>
        <p>Unranked players aren&rsquo;t on the leaderboard. Search the player directory instead.</p>
        <button type="button" className="players-open-button" onClick={onSearch}>Search all players</button>
      </div>
    );
  }
  if (state.loading) return <p role="status" className="players-status">Searching players…</p>;
  if (state.error !== undefined) return <ApiErrorNotice error={state.error} retryAt={state.retryAt} now={now} onRetry={onRetry} />;

  const results = state.results!;
  if (results.total === 0) return <p className="players-status">No players found. Try their exact Discord username or ID.</p>;

  return (
    <>
      <ul className="players-search-list">
        {results.players.map(player => (
          <li key={player.discordId}>
            <button type="button" onClick={() => onOpen(player)}>
              <strong>{player.displayName}</strong>
              <span>{player.discordId}</span>
            </button>
          </li>
        ))}
      </ul>
      {results.total > results.pageSize && (
        <nav className="players-search-pagination" aria-label="Player search pages">
          <button type="button" disabled={results.page <= 1} onClick={() => onPage(results.page - 1)}>Previous</button>
          <span>Page {results.page} of {Math.ceil(results.total / results.pageSize)}</span>
          <button type="button" disabled={results.page * results.pageSize >= results.total} onClick={() => onPage(results.page + 1)}>Next</button>
        </nav>
      )}
    </>
  );
}
