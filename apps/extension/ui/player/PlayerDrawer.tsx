import { useEffect, useRef, useState } from 'react';
import type {
  PlayerProfileSummary,
  PlayerRecentMatchSummary,
  PlayerStatsScope,
  PlayerTopUmaSummary,
  PrematchPlayer,
  PrematchTeam
} from '@umalytics/shared';
import './playerDrawer.css';
import {
  cancelPlayerHistoryPageRequest,
  cancelPlayerProfileRequest,
  sendPlayerHistoryPageRequest,
  sendPlayerProfileRequest
} from '../../runtime/messaging';
import { getFallbackUmaImageUrl, UmaImage } from '../common/UmaImage';
import { getNotableBadges } from '../common/badges';
import { formatDecimal, formatNumber, formatPercent, formatRank, formatRecord } from '../common/format';
import { getPlayerPartyVisual, getTeamPartyVisuals } from '../common/partyVisuals';
import { BestUmaPortrait } from './BestUmaPortrait';
import {
  ProfileDataStatus,
  StatCell,
  getDisplayedProfileStats,
  getLookupDiscordId,
  getPlayerNote,
  withDetailHistory
} from './playerProfileDisplay';
import { formatRecentResult, getRecentResultTone } from './recentMatchFormat';
declare const __UMALYTICS_PRIVATE_PROFILE_DATA__: boolean;

const HISTORY_PAGE_SIZE = 5;
const HISTORY_API_PAGE_SIZE = 20;
const UMA_TABLE_ROWS = 5;
const PAGER_SLOT_COUNT = 7;
const MIN_UMA_GAMES = 3;

type UmaSortKey = 'matches' | 'winRate' | 'pointsPerGame' | 'performanceScore';

const UMA_SORT_COLUMNS: { key: UmaSortKey; label: string }[] = [
  { key: 'matches', label: 'GP' },
  { key: 'winRate', label: 'Win' },
  { key: 'pointsPerGame', label: 'PPG' },
  { key: 'performanceScore', label: 'Score' }
];

export interface PlayerDrawerContext {
  team?: PrematchTeam;
  statsScope: PlayerStatsScope;
  isProfileLoading: boolean;
  now: number;
  inLobby?: boolean;
}

interface HistoryApiPage {
  total: number;
  matches: PlayerRecentMatchSummary[];
  summary?: PlayerProfileSummary['historySummary'];
}

interface HistoryState {
  key: string;
  pagerPage: number;
  apiPages: Record<number, HistoryApiPage>;
  loading: boolean;
  error?: string;
}

// The API paginates in blocks of 20; the pager paginates in blocks of 5.
// Map a pager page to the API page that contains it, and to that page's
// row offset, so moving within the same 20-row block never refetches.
function apiPageForPagerPage(pagerPage: number): number {
  return Math.floor(((pagerPage - 1) * HISTORY_PAGE_SIZE) / HISTORY_API_PAGE_SIZE) + 1;
}

function apiPageRowOffset(pagerPage: number): number {
  return ((pagerPage - 1) * HISTORY_PAGE_SIZE) % HISTORY_API_PAGE_SIZE;
}

// 600px right drawer over the lobby. Reusable for the Players page (Phase 3):
// `context` carries everything that differs between call sites (team,
// scope, loading state, now) so `player`/`profile`/`onClose` stay stable.
export function PlayerDrawer({
  player,
  profile,
  onClose,
  context
}: {
  player: PrematchPlayer;
  profile?: PlayerProfileSummary;
  onClose: () => void;
  context: PlayerDrawerContext;
}) {
  const { team, statsScope, isProfileLoading, now } = context;
  const inLobby = context.inLobby ?? team !== undefined;
  const displayedProfile = getDisplayedProfileStats(profile, statsScope);
  const rating = profile?.conservativeRating ?? profile?.rating ?? player.displayRatingSnapshot ?? player.ratingSnapshot;
  const discordId = getLookupDiscordId(player);
  const note = getPlayerNote(profile, discordId);
  const partyVisual = getPlayerPartyVisual(player, getTeamPartyVisuals(team?.players ?? []));
  const isCaptain = player.isCaptain === true || player.role === 'captain';
  const displayName = profile?.displayName ?? player.displayName;
  const historyKey = `${player.discordId}:${statsScope}`;
  const pendingHistoryRequests = useRef(new Set<string>());
  const [historyState, setHistoryState] = useState<HistoryState>({ key: historyKey, pagerPage: 0, apiPages: {}, loading: false });
  const historyLoaded = historyState.key === historyKey && historyState.pagerPage > 0;
  const historyFirstApiPage = historyState.apiPages[1];
  const detailProfile = historyLoaded && historyFirstApiPage !== undefined
    ? withDetailHistory(displayedProfile, historyFirstApiPage.matches, historyFirstApiPage.total, historyFirstApiPage.summary)
    : displayedProfile;
  const isPrivateBuild = typeof __UMALYTICS_PRIVATE_PROFILE_DATA__ !== 'undefined' && __UMALYTICS_PRIVATE_PROFILE_DATA__;
  // detailProfile.recentForm already prefers the card's batch-derived value (same
  // window as the card) over a history-derived fallback; only the build gate is
  // re-checked here so public never renders a badge from any history-based value.
  const notableBadges = getNotableBadges(
    detailProfile === undefined ? undefined : isPrivateBuild ? detailProfile : { ...detailProfile, recentForm: undefined }
  );
  const last5 = historyLoaded ? (detailProfile?.recentMatches ?? []).slice(0, 5) : [];
  const knownTitle = typeof profile?.title === 'string' && profile.title.length > 0 ? profile.title : undefined;
  const [fetchedTitle, setFetchedTitle] = useState<{ discordId: string; title: string | null } | undefined>(undefined);
  const displayedTitle = knownTitle ?? (fetchedTitle !== undefined && fetchedTitle.discordId === discordId ? fetchedTitle.title : undefined);
  const [sortKey, setSortKey] = useState<UmaSortKey>('pointsPerGame');
  const [umaPage, setUmaPage] = useState(1);
  const [includeLowGameUmas, setIncludeLowGameUmas] = useState(false);

  function selectUmaSort(key: UmaSortKey): void {
    setSortKey(key);
    setUmaPage(1);
  }

  async function loadHistoryPage(pagerPage: number): Promise<void> {
    if (discordId === undefined) return;
    const apiPage = apiPageForPagerPage(pagerPage);
    const cached = historyState.key === historyKey ? historyState.apiPages[apiPage] : undefined;
    if (cached !== undefined) {
      setHistoryState((previous) => (previous.key === historyKey ? { ...previous, pagerPage } : previous));
      return;
    }
    const requestId = crypto.randomUUID();
    pendingHistoryRequests.current.add(requestId);
    setHistoryState((previous) => (previous.key === historyKey ? { ...previous, loading: true, error: undefined } : previous));
    try {
      const result = await sendPlayerHistoryPageRequest(discordId, statsScope, apiPage, requestId);
      setHistoryState((previous) =>
        previous.key === historyKey ? {
          ...previous, pagerPage, loading: false,
          apiPages: { ...previous.apiPages, [apiPage]: { total: result.total, matches: result.matches, summary: result.summary } }
        } : previous
      );
    } catch (error) {
      setHistoryState((previous) =>
        previous.key === historyKey
          ? { ...previous, loading: false, error: error instanceof Error ? error.message : 'History unavailable.' }
          : previous
      );
    } finally {
      pendingHistoryRequests.current.delete(requestId);
    }
  }

  useEffect(() => {
    setHistoryState({ key: historyKey, pagerPage: 0, apiPages: {}, loading: true });
    setUmaPage(1);
    setIncludeLowGameUmas(false);
    if (discordId !== undefined) void loadHistoryPage(1);
    return () => {
      for (const requestId of pendingHistoryRequests.current) void cancelPlayerHistoryPageRequest(requestId).catch(() => {});
      pendingHistoryRequests.current.clear();
    };
    // Re-run only when the identity+scope key changes; loadHistoryPage closes over historyKey itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);

  useEffect(() => {
    if (discordId === undefined || knownTitle !== undefined) return;
    let cancelled = false;
    const requestId = crypto.randomUUID();
    void sendPlayerProfileRequest(discordId, requestId)
      .then((result) => {
        if (!cancelled) setFetchedTitle({ discordId, title: result.title });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      void cancelPlayerProfileRequest(requestId).catch(() => {});
    };
  }, [discordId, knownTitle]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const umaSourceAll = displayedProfile?.allUmas ?? displayedProfile?.topUmas ?? [];
  const lowGameUmaCount = umaSourceAll.filter((uma) => (uma.matches ?? 0) < MIN_UMA_GAMES).length;
  const umaSource = includeLowGameUmas ? umaSourceAll : umaSourceAll.filter((uma) => (uma.matches ?? 0) >= MIN_UMA_GAMES);
  const hasScoreColumn = umaSource.some((uma) => uma.performanceScore !== undefined);
  const effectiveSortKey = sortKey === 'performanceScore' && !hasScoreColumn ? 'pointsPerGame' : sortKey;
  const sortedUmas = [...umaSource].sort((a, b) => umaSortValue(b, effectiveSortKey) - umaSortValue(a, effectiveSortKey));
  const umaTotalPages = Math.max(1, Math.ceil(sortedUmas.length / UMA_TABLE_ROWS));
  const umaCurrentPage = Math.min(umaPage, umaTotalPages);
  const umaRows = sortedUmas.slice((umaCurrentPage - 1) * UMA_TABLE_ROWS, umaCurrentPage * UMA_TABLE_ROWS);
  const umaColumns = UMA_SORT_COLUMNS.filter((column) => column.key !== 'performanceScore' || hasScoreColumn);
  const umaGridStyle = { gridTemplateColumns: `minmax(0, 1fr) ${umaColumns.map(() => '52px').join(' ')}` };

  const totalMatches = historyLoaded && historyFirstApiPage !== undefined ? historyFirstApiPage.total : 0;
  const totalPages = Math.max(1, Math.ceil(totalMatches / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(Math.max(historyState.pagerPage, 1), totalPages);
  const currentApiPage = historyState.apiPages[apiPageForPagerPage(currentPage)];
  const historyRows = historyLoaded && currentApiPage !== undefined
    ? currentApiPage.matches.slice(apiPageRowOffset(currentPage), apiPageRowOffset(currentPage) + HISTORY_PAGE_SIZE)
    : [];
  const showRatingColumn = historyRows.some((match) => (match.eloDelta !== null && match.eloDelta !== undefined) || match.eloPlacement === true);
  const historyGridStyle = { gridTemplateColumns: showRatingColumn ? '36px 88px minmax(0, 1fr) 64px 64px' : '36px 88px minmax(0, 1fr) 64px' };
  const pagerSlots = getPagerSlots(currentPage, totalPages);

  return (
    <>
      <button type="button" className="player-drawer-backdrop" aria-label="Close details" onClick={onClose} />
      <aside className="player-drawer" aria-label="Player details">
        <div className="player-drawer-head">
          <div className="player-drawer-identity">
            <div className="player-drawer-title-row">
              <h2>{displayName}</h2>
              {displayedTitle === undefined ? null : <span className="player-title">{displayedTitle}</span>}
            </div>
            <div className="player-rank-line">
              {team === undefined || !inLobby ? null : (
                <>
                  <span className="player-drawer-team-dot" aria-hidden="true" />
                  <span>{inLobby ? team.name ?? team.id : undefined}</span>
                  <span aria-hidden="true">&middot;</span>
                </>
              )}
              <span>{formatRank(profile, isProfileLoading && discordId !== undefined)}</span>
              <span>{rating === undefined || rating === null ? 'Rating unknown' : `${rating} rating`}</span>
              {displayedProfile?.matches === undefined || displayedProfile.matches === null ? null : (
                <>
                  <span aria-hidden="true">&middot;</span>
                  <span>{displayedProfile.matches} games</span>
                </>
              )}
            </div>
            <div className="player-badge-row">
              {isCaptain ? <span className="player-tag notable-tag rank">Captain</span> : null}
              {partyVisual === undefined ? null : (
                <span className={`identity-tag ${partyVisual.className}`} title={partyVisual.title}>
                  {partyVisual.label}
                </span>
              )}
              {notableBadges.map((badge) => (
                <span key={badge.label} className={`player-tag notable-tag ${badge.tone}`} title={badge.title}>
                  {badge.label}
                </span>
              ))}
            </div>
            <ProfileDataStatus discordId={discordId} profile={profile} isProfileLoading={isProfileLoading} now={now} />
          </div>
          <button type="button" className="iconbtn" aria-label="Close details" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="drawer-stat-row">
          <div className="drawer-stat-panel">
            <StatCell label="W-L" value={formatRecord(displayedProfile)} title="Ranked win-loss record for the selected stat scope." variant="record" />
            <StatCell label="Win rate" value={formatPercent(displayedProfile?.winRate)} title="Ranked win rate for the selected stat scope." />
            <StatCell label="Pts / game" value={formatDecimal(displayedProfile?.pointsPerGame)} title="Average ranked points per game for the selected stat scope." />
            <StatCell label="MVP" value={formatNumber(displayedProfile?.mvpMatches)} title="Total ranked MVP games for the selected stat scope." />
          </div>
          {displayedProfile?.historyDerived ? <EstimatedChip profile={displayedProfile} /> : null}
        </div>

        <section className="drawer-section drawer-umas" aria-label="Umas">
          <div className="drawer-section-head">
            <h3>Umas</h3>
            <span className="drawer-section-hint">Sorted by {umaColumns.find((column) => column.key === effectiveSortKey)?.label.toLowerCase() ?? 'ppg'}</span>
            <div className="drawer-section-spacer" />
            {sortedUmas.length > UMA_TABLE_ROWS ? (
              <div className="uma-pager" aria-label="Uma pages">
                <span className="uma-pager-range">
                  {(umaCurrentPage - 1) * UMA_TABLE_ROWS + 1}–{Math.min(umaCurrentPage * UMA_TABLE_ROWS, sortedUmas.length)} of {sortedUmas.length}
                </span>
                <button
                  type="button"
                  className="uma-pager-btn"
                  aria-label="Previous Umas"
                  disabled={umaCurrentPage <= 1}
                  onClick={() => setUmaPage((page) => Math.max(1, page - 1))}
                >
                  &lsaquo;
                </button>
                <button
                  type="button"
                  className="uma-pager-btn"
                  aria-label="Next Umas"
                  disabled={umaCurrentPage >= umaTotalPages}
                  onClick={() => setUmaPage((page) => Math.min(umaTotalPages, page + 1))}
                >
                  &rsaquo;
                </button>
              </div>
            ) : null}
          </div>
          {sortedUmas.length === 0 ? (
            <p className="section-message">No ranked Uma data found.</p>
          ) : (
            <>
              <div className="uma-table-head" style={umaGridStyle}>
                <span className="lbl">Uma</span>
                {umaColumns.map((column) => (
                  <button
                    key={column.key}
                    type="button"
                    className={effectiveSortKey === column.key ? 'th on' : 'th'}
                    onClick={() => selectUmaSort(column.key)}
                  >
                    {column.label}
                    {effectiveSortKey === column.key ? ' ▾' : ''}
                  </button>
                ))}
              </div>
              <div className="uma-table-rows">
                {umaRows.map((uma) => (
                  <div key={uma.umaId} className="uma-table-row" style={umaGridStyle}>
                    <span className="uma-table-name">
                      <BestUmaPortrait uma={uma} />
                      <span className="uma-name" title={uma.name}>{uma.name}</span>
                    </span>
                    {umaColumns.map((column) => (
                      <span key={column.key} className="uma-table-value">{formatUmaColumnValue(uma, column.key)}</span>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
          {lowGameUmaCount > 0 ? (
            <div className="uma-table-footer">
              <button
                type="button"
                className="drawer-toggle-button"
                onClick={() => {
                  setIncludeLowGameUmas((value) => !value);
                  setUmaPage(1);
                }}
              >
                {includeLowGameUmas ? `Hide <${MIN_UMA_GAMES} games` : `+${lowGameUmaCount} with <${MIN_UMA_GAMES} games`}
              </button>
            </div>
          ) : null}
        </section>

        <section className="drawer-section drawer-history" aria-label="Match history">
          <div className="drawer-section-head">
            <h3>Match history</h3>
            <div className="drawer-last5" aria-label="Last 5 results">
              {Array.from({ length: 5 }, (_, index) => {
                const match = last5[index];
                if (match === undefined) {
                  return (
                    <span key={index} className="dot dot-u" aria-hidden="true">&middot;</span>
                  );
                }
                const tone = getRecentResultTone(match);
                const dotClass = tone === 'win' ? 'dot dot-w' : tone === 'loss' ? 'dot dot-l' : 'dot dot-u';
                const label = tone === 'win' ? 'W' : tone === 'loss' ? 'L' : '·';
                return (
                  <span key={match.matchId} className={dotClass} title={`${label} · ${match.matchId}`}>
                    {label}
                  </span>
                );
              })}
            </div>
            <div className="drawer-section-spacer" />
            <span className="drawer-section-hint">
              {totalMatches > 0 ? `Matches ${(currentPage - 1) * HISTORY_PAGE_SIZE + 1}–${Math.min(currentPage * HISTORY_PAGE_SIZE, totalMatches)} of ${totalMatches}` : ''}
            </span>
          </div>
          <div className="drawer-history-rows">
            {historyState.loading ? (
              Array.from({ length: HISTORY_PAGE_SIZE }, (_, index) => (
                <div key={index} className="drawer-history-row-skel" style={historyGridStyle}>
                  <span className="card-skel" style={{ width: 30, height: 20 }} />
                  <span className="card-skel" style={{ height: 12 }} />
                  <span className="card-skel" style={{ height: 12, width: '70%' }} />
                  <span className="card-skel" style={{ height: 12 }} />
                </div>
              ))
            ) : historyRows.length === 0 ? (
              <p className="section-message">{historyState.error ?? 'No recent match history found.'}</p>
            ) : (
              historyRows.map((match) => (
                <div key={match.matchId} className="drawer-history-row" style={historyGridStyle}>
                  <span className={`recent-result ${getRecentResultTone(match)}`}>{formatRecentResult(match)}</span>
                  <a
                    href={`https://drafter.uma.guide/matches/${encodeURIComponent(match.matchId)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="recent-match-code"
                  >
                    {match.matchId}
                  </a>
                  <span className="uma-table-name">
                    <span className="uma-mono" aria-hidden="true">
                      <UmaImage imageUrl={match.umaId === null ? undefined : getFallbackUmaImageUrl(match.umaId)} name={match.umaName} />
                    </span>
                    <span className="uma-name" title={match.umaName}>{match.umaName}</span>
                  </span>
                  <span className="uma-table-value drawer-history-points">
                    {match.pointsScored} pts
                    {match.isMvp ? (
                      <span className="mvp-star" tabIndex={0}>
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                          <path d="M6 0l1.76 3.64L12 4.24l-3 2.92.71 4.13L6 9.27 2.29 11.29 3 7.16 0 4.24l4.24-.6z" />
                        </svg>
                        <span className="mvp-star-tooltip" role="tooltip">MVP</span>
                      </span>
                    ) : null}
                  </span>
                  {showRatingColumn ? (
                    <span className="uma-table-value drawer-history-rating">
                      {match.eloDelta !== null && match.eloDelta !== undefined
                        ? `${match.eloDelta >= 0 ? '+' : ''}${match.eloDelta}`
                        : match.eloPlacement === true
                          ? 'placement'
                          : ''}
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <nav className="drawer-pager" aria-label="Match history pages">
            <button type="button" className="pg" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => void loadHistoryPage(currentPage - 1)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {pagerSlots.map((slot, index) =>
              slot === 'gap' ? (
                <span key={`gap-${index}`} className="pg-gap" aria-hidden="true">&hellip;</span>
              ) : (
                <button
                  key={slot}
                  type="button"
                  className={slot === currentPage ? 'pg on' : 'pg'}
                  aria-label={`Page ${slot}`}
                  onClick={() => void loadHistoryPage(slot)}
                >
                  {slot}
                </button>
              )
            )}
            <button type="button" className="pg" aria-label="Next page" disabled={currentPage >= totalPages} onClick={() => void loadHistoryPage(currentPage + 1)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </nav>
        </section>

        {note === undefined || note === 'Profile data has not loaded yet.' ? null : <p className="player-note">{note}</p>}
      </aside>
    </>
  );
}

export function EstimatedChip({ profile }: { profile: PlayerProfileSummary | undefined }) {
  // Not a public field: the same structural read the private card indicator uses.
  const matches = (profile as (PlayerProfileSummary & { historyDerivedMatchCount?: number }) | undefined)?.historyDerivedMatchCount;

  return (
    <span className="drawer-estimated-chip" tabIndex={0}>
      Estimated
      <span className="drawer-estimated-tooltip" role="tooltip">
        Stats worked out from match history (up to 100 matches per scope){typeof matches === 'number' ? ` · ${matches} matches` : ''}
      </span>
    </span>
  );
}

function umaSortValue(uma: PlayerTopUmaSummary, key: UmaSortKey): number {
  const value = uma[key];
  return value === null || value === undefined ? -1 : Number(value);
}

function formatUmaColumnValue(uma: PlayerTopUmaSummary, key: UmaSortKey): string {
  switch (key) {
    case 'matches':
      return formatNumber(uma.matches);
    case 'winRate':
      return formatPercent(uma.winRate);
    case 'pointsPerGame':
      return formatDecimal(uma.pointsPerGame);
    case 'performanceScore':
      return formatNumber(uma.performanceScore);
  }
}

// Always 7 equal-width slots once there are more than 7 pages, so the pager
// never changes width as its numbers grow.
export function getPagerSlots(page: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= PAGER_SLOT_COUNT) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (page <= 4) {
    return [1, 2, 3, 4, 5, 'gap', totalPages];
  }

  if (page >= totalPages - 3) {
    return [1, 'gap', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, 'gap', page - 1, page, page + 1, 'gap', totalPages];
}
