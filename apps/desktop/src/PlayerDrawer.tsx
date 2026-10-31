import { useEffect, useRef, useState } from 'react';
import { useUiServices, type PlayerHistoryPage } from '@umalytics/ui';
import type { PlayerProfileSummary, PlayerStatsScope, PlayerTopUmaSummary, PrematchPlayer } from '@umalytics/shared';
import { getDisplayedProfileStats, getLookupDiscordId } from '@umalytics/ui/player/playerProfileDisplay';
import { BestUmaPortrait } from '@umalytics/ui/player/BestUmaPortrait';
import { getNotableBadges } from '@umalytics/ui/common/badges';
import { formatDecimal, formatNumber, formatPercent, formatRank, formatRecord } from '@umalytics/ui/common/format';
import { getPagerSlots } from '@umalytics/ui/player/PlayerDrawer';
import { formatRecentResult, getRecentResultTone } from '@umalytics/ui/player/recentMatchFormat';

const allowedBadges = new Set(['oneTrick', 'deepPool', 'podiumRegular', 'underrated', 'newcomer']);
export function usePlayerProfile(player: PrematchPlayer | undefined, scope: PlayerStatsScope) {
  const { loadExplorerProfiles } = useUiServices();
  const [state, setState] = useState<{ key: string; profile?: PlayerProfileSummary; loading: boolean; error?: string }>({ key: '', loading: false });
  const key = `${player?.discordId}:${scope}`;
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, loading: !!player });
    if (player) void loadExplorerProfiles([player], scope, next => {
      if (!controller.signal.aborted) setState({ key, profile: next[player.discordId], loading: true });
    }, controller.signal).then(next => { if (!controller.signal.aborted) setState({ key, profile: next[player.discordId], loading: false }); })
      .catch(() => { if (!controller.signal.aborted) setState({ key, loading: false, error: 'Profile unavailable' }); });
    return () => controller.abort();
  }, [key]);
  return state.key === key ? state : { loading: !!player, profile: undefined };
}

export function StatStrip({ profile }: { profile?: PlayerProfileSummary }) {
  return <div className="arena-stats drawer-stat-strip">{[['W–L', formatRecord(profile)], ['Win rate', formatPercent(profile?.winRate)], ['Pts / game', formatDecimal(profile?.pointsPerGame)], ['MVP', formatNumber(profile?.mvpMatches)]].map(([label, value]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}</div>;
}

export function PlayerDrawer({ player, profile, scope, loading, onClose, onOpenMatch }: {
  player: PrematchPlayer; profile?: PlayerProfileSummary; scope: PlayerStatsScope; loading: boolean; onClose: () => void; onOpenMatch: (code: string) => void;
}) {
  const services = useUiServices();
  const drawer = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [sort, setSort] = useState<keyof Pick<PlayerTopUmaSummary, 'matches' | 'winRate' | 'pointsPerGame' | 'performanceScore'>>('matches');
  const [ascending, setAscending] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<Record<number, PlayerHistoryPage>>({});
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [title, setTitle] = useState<string | null>();
  const key = `${player.discordId}:${scope}`;
  const id = getLookupDiscordId(player);
  const apiPage = Math.floor((page - 1) / 4) + 1;
  const p = profile?.statsPrivate ? undefined : getDisplayedProfileStats(profile, scope);
  const rankTier = p?.rank != null && p.rank <= 10 ? 'rank-top10' : p?.rank != null && p.rank <= 25 ? 'rank-top25' : '';
  const all = p?.allUmas ?? p?.topUmas ?? [];
  const banner = [...all].sort((a, b) => b.matches - a.matches)[0];
  const umas = all.filter(u => showAll || u.matches >= 3).sort((a, b) => ((a[sort] ?? -1) - (b[sort] ?? -1)) * (ascending ? 1 : -1) || a.name.localeCompare(b.name));
  const total = pages[1]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 5));
  const rows = pages[apiPage]?.matches.slice(((page - 1) % 4) * 5, ((page - 1) % 4) * 5 + 5) ?? [];
  useEffect(() => { setPage(1); setPages({}); setShowAll(false); setTitle(undefined); }, [key]);
  useEffect(() => {
    if (!id || pages[apiPage]) return;
    let disposed = false;
    const request = crypto.randomUUID();
    setHistoryLoading(true); setHistoryError('');
    void services.sendPlayerHistoryPageRequest(id, scope, apiPage, request).then(result => {
      if (!disposed) setPages(previous => ({ ...previous, [apiPage]: result }));
    }).catch(() => { if (!disposed) setHistoryError('History unavailable.'); })
      .finally(() => { if (!disposed) setHistoryLoading(false); });
    return () => { disposed = true; void services.cancelPlayerHistoryPageRequest(request).catch(() => {}); };
  }, [key, apiPage, retry]);
  useEffect(() => {
    if (!id || profile?.title) return;
    let disposed = false; const request = crypto.randomUUID();
    void services.sendPlayerProfileRequest(id, request).then(result => { if (!disposed) setTitle(result.title); }).catch(() => {});
    return () => { disposed = true; void services.cancelPlayerProfileRequest(request).catch(() => {}); };
  }, [id, profile?.title]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const elements = [...drawer.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input')];
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  return <div className="arena-drawer-layer">
    <button className="arena-backdrop" aria-label="Close player details" onClick={onClose}/>
    <aside className="arena-player-drawer player-drawer" role="dialog" aria-modal="true" aria-label="Player details" ref={drawer}>
      <header className="arena-drawer-banner">
        {banner && <div className="drawer-banner-art"><BestUmaPortrait uma={banner}/></div>}
        <div className="drawer-identity"><h2>{profile?.displayName ?? player.displayName}</h2><p className="muted">{profile?.title ?? title}</p><div className="drawer-rank"><span className={`rank num ${rankTier}`}>{formatRank(p, loading)}</span><span><b className="num">{formatNumber(profile?.conservativeRating ?? profile?.rating ?? player.displayRatingSnapshot ?? player.ratingSnapshot)}</b> rating</span><span>{scope === 'currentSeason' ? 'Season' : 'All-time'}</span></div>
        <div className="drawer-badges">{getNotableBadges(p).filter(b => allowedBadges.has(b.kind)).map(b => <span key={b.kind} title={b.title}>{b.label}</span>)}</div></div>
        <button className="iconbtn drawer-close" aria-label="Close details" ref={close} onClick={onClose}>×</button>
      </header>
      <div className="arena-drawer-body">
        {loading && <p role="status">Loading profile…</p>}{profile?.statsPrivate && <p>Stats are private</p>}{profile?.error && <p role="status">{profile.error}</p>}
        <StatStrip profile={p}/>
        <section className="drawer-umas"><div className="data-heading"><h3>Umas</h3><small>{umas.length} Umas · ranked stats</small></div>
          <table className="quiet-table" aria-label="Player Uma stats"><thead><tr><th>Uma</th>{([['matches', 'GP'], ['winRate', 'Win'], ['pointsPerGame', 'PPG'], ['performanceScore', 'Score']] as const).map(([column, label]) => <th key={column} aria-sort={sort === column ? ascending ? 'ascending' : 'descending' : 'none'}><button onClick={() => { setAscending(sort === column ? !ascending : false); setSort(column); }}>{label}{sort === column ? ascending ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead>
          <tbody>{umas.map(u => <tr key={u.umaId}><th scope="row"><span className="table-identity"><BestUmaPortrait uma={u}/><span>{u.name}</span></span></th><td>{u.matches}</td><td>{formatPercent(u.winRate)}</td><td>{formatDecimal(u.pointsPerGame)}</td><td>{formatNumber(u.performanceScore)}</td></tr>)}</tbody></table>
          {!umas.length && <p className="muted">No ranked Uma stats.</p>}
          {all.some(u => u.matches < 3) && <div className="data-heading low-games"><small>{all.filter(u => u.matches < 3).length} Umas with fewer than 3 games {showAll ? 'shown' : 'hidden'}</small><button aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide <3 games' : 'Show all'}</button></div>}
        </section>
        <section className="drawer-history"><div className="data-heading"><h3>Match history</h3><small>{total} matches · display only</small></div>
          <div className="drawer-history-fixed" aria-busy={historyLoading}><table className="quiet-table" aria-label="Player match history"><thead><tr><th>Match</th><th>Uma</th><th>Result</th><th>Pts</th><th>Rating</th></tr></thead><tbody>{rows.map((m, i) => <tr key={`${m.matchId}-${i}`}><th scope="row"><button className="text-link recent-match-code" title={m.reportedAt} onClick={() => { onOpenMatch(m.matchId); onClose(); }}>{m.matchId}</button></th><td className="table-text">{m.umaName}</td><td className={getRecentResultTone(m)}>{formatRecentResult(m)}{m.isMvp ? ' ★' : ''}</td><td>{m.pointsScored}</td><td>{m.eloDelta == null ? m.eloPlacement ? 'placement' : '—' : `${m.eloDelta >= 0 ? '+' : ''}${m.eloDelta}`}</td></tr>)}</tbody></table>
          {historyLoading && !rows.length && <p role="status">Loading history…</p>}{historyError && <p role="alert">{historyError} <button onClick={() => setRetry(v => v + 1)}>Retry history</button></p>}{!id && <p>No linked profile.</p>}{id && !historyLoading && !historyError && !rows.length && <p>No matches found.</p>}</div>
        </section>
      </div>
      <nav className="data-pager drawer-fixed-pager" aria-label="Match history pages"><button aria-label="Previous page" disabled={page <= 1 || historyLoading} onClick={() => setPage(page - 1)}>‹</button>{getPagerSlots(page, totalPages).map((n, i) => n === 'gap' ? <span key={`gap-${i}`}>…</span> : <button key={n} aria-label={`Page ${n}`} aria-current={n === page ? 'page' : undefined} disabled={historyLoading} onClick={() => setPage(n)}>{n}</button>)}<button aria-label="Next page" disabled={page >= totalPages || historyLoading} onClick={() => setPage(page + 1)}>›</button><span>Page {page} of {totalPages}</span></nav>
    </aside>
  </div>;
}
