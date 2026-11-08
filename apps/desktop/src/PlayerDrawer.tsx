import { DiscordName } from './DiscordName';
import { useEffect, useId, useRef, useState } from 'react';
import { useUiServices, type PlayerHistoryPage } from '@umalytics/ui';
import type { EsportsTeamIcon, PlayerProfileSummary, PlayerStatsScope, PlayerTopUmaSummary, PrematchPlayer } from '@umalytics/shared';
import { DesktopTeamIcon } from './TeamIcon';
import { getDisplayedProfileStats, getLookupDiscordId } from '@umalytics/ui/player/playerProfileDisplay';
import { UmaImage, getFallbackUmaImageUrl } from '@umalytics/ui/common/UmaImage';
import { DRAWER_PAGE_SIZE, getHistoryPageRows, getHistoryPageSlices } from './playerDrawerPaging';
import { BestUmaPortrait } from '@umalytics/ui/player/BestUmaPortrait';
import { BadgeIcon, badgeToneStyle } from '@umalytics/ui/lobby/BadgeChip';
import { getNotableBadges } from '@umalytics/ui/common/badges';
import { formatDecimal, formatNumber, formatPercent, formatRank } from '@umalytics/ui/common/format';
import { getPagerSlots } from '@umalytics/ui/player/PlayerDrawer';
import { formatRecentResult, getRecentResultTone } from '@umalytics/ui/player/recentMatchFormat';

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

export function PlayerDrawer({ player, profile, scope, loading, onClose, onOpenMatch, teamIcon, onScopeChange }: {
  player: PrematchPlayer; profile?: PlayerProfileSummary; scope: PlayerStatsScope; loading: boolean; onClose: () => void; onOpenMatch: (code: string) => void; teamIcon?: EsportsTeamIcon; onScopeChange: (scope: PlayerStatsScope) => void;
}) {
  const services = useUiServices();
  const drawer = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [sort, setSort] = useState<keyof Pick<PlayerTopUmaSummary, 'matches' | 'winRate' | 'pointsPerGame' | 'performanceScore'>>('matches');
  const [ascending, setAscending] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [umaPage, setUmaPage] = useState(1);
  const [page, setPage] = useState(1);
  const [pageKey, setPageKey] = useState('');
  const [history, setHistory] = useState<{ key: string; pages: Record<number, PlayerHistoryPage> }>({ key: '', pages: {} });
  const [tab, setTab] = useState<'umas' | 'matches'>(profile?.statsPrivate ? 'matches' : 'umas');
  const choseTab = useRef(false);
  const tabsId = useId();
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [title, setTitle] = useState<string | null>();
  const key = `${player.discordId}:${scope}`;
  const id = getLookupDiscordId(player);
  const currentPage = pageKey === key ? page : 1;
  const pages = history.key === key ? history.pages : {};
  const p = loading || profile?.statsPrivate ? undefined : getDisplayedProfileStats(profile, scope);
  const rankTier = p?.rank != null && p.rank <= 10 ? 'rank-top10' : p?.rank != null && p.rank <= 25 ? 'rank-top25' : '';
  const all = p?.allUmas ?? p?.topUmas ?? [];
  const banner = [...all].sort((a, b) => b.matches - a.matches)[0];
  const umas = all.filter(u => showAll || u.matches >= 3).sort((a, b) => ((a[sort] ?? -1) - (b[sort] ?? -1)) * (ascending ? 1 : -1) || a.name.localeCompare(b.name));
  const umaPages = Math.max(1, Math.ceil(umas.length / DRAWER_PAGE_SIZE));
  const currentUmaPage = Math.min(umaPage, umaPages);
  const umaRows = umas.slice((currentUmaPage - 1) * DRAWER_PAGE_SIZE, currentUmaPage * DRAWER_PAGE_SIZE);
  const total = pages[1]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / DRAWER_PAGE_SIZE));
  const rows = getHistoryPageRows(pages, currentPage, total);
  const requiredPages = tab === 'matches' && pages[1]
    ? getHistoryPageSlices(currentPage, total).map(slice => slice.apiPage) : [1];
  const requiredKey = requiredPages.join(',');
  const hiddenUmas = all.filter(u => u.matches < 3).length;
  const value = (formatted: string) => formatted === '-' ? '—' : formatted;
  const stats = [
    ['Rank', !p ? '—' : formatRank(p, false)],
    ['Rating', !p ? '—' : value(formatNumber(profile?.conservativeRating ?? profile?.rating ?? player.displayRatingSnapshot ?? player.ratingSnapshot))],
    ['W–L', p?.wins == null || p?.losses == null ? '—' : `${p.wins}–${p.losses}`],
    ['Win', value(formatPercent(p?.winRate))], ['PPG', value(formatDecimal(p?.pointsPerGame))], ['MVP', value(formatNumber(p?.mvpMatches))]
  ];
  const selectTab = (next: 'umas' | 'matches') => { choseTab.current = true; setTab(next); };
  useEffect(() => { if (profile?.statsPrivate && !choseTab.current) setTab('matches'); }, [profile?.statsPrivate]);
  useEffect(() => { setPage(1); setPageKey(key); setUmaPage(1); setShowAll(false); }, [key]);
  useEffect(() => {
    const missing = requiredPages.filter(apiPage => !pages[apiPage]);
    setHistoryError('');
    if (!id || !missing.length) { setHistoryLoading(false); return; }
    let disposed = false;
    const requests = missing.map(apiPage => ({ apiPage, request: crypto.randomUUID() }));
    setHistoryLoading(true);
    void Promise.all(requests.map(async ({ apiPage, request }) => {
      try {
        const result = await services.sendPlayerHistoryPageRequest(id, scope, apiPage, request);
        if (!disposed) setHistory(previous => ({ key, pages: { ...(previous.key === key ? previous.pages : {}), [apiPage]: result } }));
      } catch { if (!disposed) setHistoryError('History unavailable.'); }
    })).finally(() => { if (!disposed) setHistoryLoading(false); });
    return () => {
      disposed = true;
      for (const { request } of requests) void services.cancelPlayerHistoryPageRequest(request).catch(() => {});
    };
  }, [key, requiredKey, retry]);
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
        const elements = [...drawer.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, [tabindex="0"]')].filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  return <div className="arena-drawer-layer">
    <button className="arena-backdrop" aria-label="Close player details" tabIndex={-1} onClick={onClose}/>
    <aside className="arena-player-drawer player-drawer" role="dialog" aria-modal="true" aria-label="Player details" ref={drawer}>
      <header className="arena-drawer-banner">
        <div className={`drawer-portrait ${rankTier}`}>{banner && <BestUmaPortrait uma={banner}/>}</div>
        <div className="drawer-identity"><h2><DiscordName name={profile?.displayName ?? player.displayName} username={player.discordUsername}/></h2><div className="drawer-subtitle"><span className="muted">{profile?.title ?? title}</span>{teamIcon && <span className="drawer-esports-team"><DesktopTeamIcon icon={teamIcon}/><span>{teamIcon.teamName}</span></span>}</div></div>
        <button className="iconbtn drawer-close" aria-label="Close details" ref={close} onClick={onClose}>×</button>
      </header>
      <div className="drawer-stat-band">{stats.map(([label, stat]) => <div key={label}><span>{label}</span><b className={label === 'Rank' ? rankTier : undefined}>{stat}</b></div>)}</div>
      <div className="drawer-badges">{getNotableBadges(p).map(b => <span key={b.kind} className={`player-tag notable-tag ${b.tone}`} style={{ ...badgeToneStyle(b.kind), borderColor: badgeToneStyle(b.kind)?.color }} title={b.title}>{b.kind !== 'private' && <BadgeIcon kind={b.kind}/>}<span>{b.label}</span></span>)}</div>
      <div className="profile-drawer-tabs-row">
        <div className="profile-drawer-tabs" role="tablist" aria-label="Player details">{(['umas', 'matches'] as const).map(name => <button key={name} role="tab" id={`${tabsId}-${name}`} aria-controls={`${tabsId}-${name}-panel`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => selectTab(name)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'umas' : event.key === 'End' ? 'matches' : name === 'umas' ? 'matches' : 'umas';
          selectTab(next); document.getElementById(`${tabsId}-${next}`)?.focus();
        }}>{name === 'umas' ? 'Umas' : 'Matches'} <small>{name === 'umas' ? all.length : pages[1] ? total : '—'}</small></button>)}</div>
        <div className="seg" role="group" aria-label="Stats scope">{(['currentSeason', 'allTime'] as const).map(scopeValue => <button key={scopeValue} aria-pressed={scope === scopeValue} onClick={() => onScopeChange(scopeValue)}>{scopeValue === 'currentSeason' ? 'Season' : 'All-time'}</button>)}</div>
      </div>
      <div className="arena-drawer-body">
        {!id && <p>No linked profile.</p>}{loading && <p role="status">Loading profile…</p>}{profile?.statsPrivate && <p>Stats are private</p>}{profile?.error && <p role="status">{profile.error}</p>}
        {(['umas', 'matches'] as const).map(name => <section key={name} hidden={tab !== name} className={name === 'umas' ? 'drawer-umas' : 'drawer-history'} role="tabpanel" id={`${tabsId}-${name}-panel`} aria-labelledby={`${tabsId}-${name}`} tabIndex={0}>
          {tab === name && (tab === 'umas' ? <>
            <table className="quiet-table" aria-label="Player Uma stats"><colgroup><col/><col style={{ width: 44 }}/><col style={{ width: 64 }}/><col style={{ width: 48 }}/><col style={{ width: 52 }}/></colgroup><thead><tr><th scope="col">Uma</th>{([['matches', 'GP'], ['winRate', 'Win'], ['pointsPerGame', 'PPG'], ['performanceScore', 'Score']] as const).map(([column, label]) => <th scope="col" key={column} aria-sort={sort === column ? ascending ? 'ascending' : 'descending' : 'none'}><button onClick={() => { setAscending(sort === column ? !ascending : false); setSort(column); setUmaPage(1); }}>{label}{sort === column ? ascending ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead>
              <tbody>{umaRows.map(u => <tr key={u.umaId}><th scope="row"><span className="table-identity"><BestUmaPortrait uma={u}/><span>{u.name}</span></span></th><td>{u.matches}</td><td>{formatPercent(u.winRate)}<span className="drawer-win-bar"><span style={{ width: `${Math.min(100, Math.max(0, (u.winRate ?? 0) * 100))}%` }}/></span></td><td>{formatDecimal(u.pointsPerGame)}</td><td>{formatNumber(u.performanceScore)}</td></tr>)}</tbody>
            </table>{!umas.length && <p className="muted">No ranked Uma stats.</p>}
          </> : <div className="drawer-history-fixed" aria-busy={historyLoading}>
            <table className="quiet-table" aria-label="Player match history"><colgroup><col style={{ width: 76 }}/><col/><col style={{ width: 52 }}/><col style={{ width: 34 }}/><col style={{ width: 64 }}/></colgroup><thead><tr><th scope="col">Match</th><th scope="col">Uma</th><th scope="col">Result</th><th scope="col">Pts</th><th scope="col">Rating</th></tr></thead><tbody>{rows.map((m, i) => <tr key={`${m.matchId}-${i}`}>
              <th scope="row"><button className="text-link recent-match-code" title={m.reportedAt} onClick={() => { onOpenMatch(m.matchId); onClose(); }}>{m.matchId}</button><time className="drawer-match-date" dateTime={m.reportedAt} title={m.reportedAt}>{Number.isNaN(Date.parse(m.reportedAt)) ? '—' : new Date(m.reportedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></th>
              <td className="table-text"><span className="table-identity"><span className="drawer-match-portrait" aria-hidden="true"><UmaImage imageUrl={m.umaId ? getFallbackUmaImageUrl(m.umaId) : undefined} name={m.umaName}/></span><span>{m.umaName}</span></span></td>
              <td><span className={getRecentResultTone(m)}>{formatRecentResult(m)}</span>{m.isMvp && <span className="drawer-mvp" aria-label="MVP"> ★</span>}</td><td>{m.pointsScored}</td><td className={m.eloDelta == null || m.eloDelta === 0 ? undefined : m.eloDelta > 0 ? 'win' : 'loss'}>{m.eloDelta == null ? m.eloPlacement ? 'placement' : '—' : `${m.eloDelta >= 0 ? '+' : ''}${m.eloDelta}`}</td>
            </tr>)}</tbody></table>
            {historyLoading && !rows.length && <p role="status">Loading history…</p>}{historyError && <p role="alert">{historyError} <button onClick={() => setRetry(v => v + 1)}>Retry history</button></p>}{id && !historyLoading && !historyError && !rows.length && <p>No matches found.</p>}
          </div>)}
        </section>)}
      </div>
      <footer className="profile-drawer-footer">{tab === 'umas' ? <>
        <div className="profile-drawer-footer-note"><span>{hiddenUmas} Umas under 3 games {showAll ? 'shown' : 'hidden'}</span>{hiddenUmas > 0 && <button aria-pressed={showAll} onClick={() => { setShowAll(!showAll); setUmaPage(1); }}>{showAll ? 'Hide' : 'Show all'}</button>}</div>
        <nav className="uma-section-pager" aria-label="Uma pages"><button aria-label="Previous Umas" disabled={currentUmaPage <= 1} onClick={() => setUmaPage(currentUmaPage - 1)}>‹</button><span>{currentUmaPage}/{umaPages}</span><button aria-label="Next Umas" disabled={currentUmaPage >= umaPages} onClick={() => setUmaPage(currentUmaPage + 1)}>›</button></nav>
      </> : <><span>Display only</span><nav className="data-pager drawer-fixed-pager" aria-label="Match history pages"><button aria-label="Previous page" disabled={currentPage <= 1 || historyLoading} onClick={() => setPage(currentPage - 1)}>‹</button>{getPagerSlots(currentPage, totalPages).map((n, i) => n === 'gap' ? <span key={`gap-${i}`}>…</span> : <button key={n} aria-label={`Page ${n}`} aria-current={n === currentPage ? 'page' : undefined} disabled={historyLoading} onClick={() => setPage(n)}>{n}</button>)}<button aria-label="Next page" disabled={currentPage >= totalPages || historyLoading} onClick={() => setPage(currentPage + 1)}>›</button></nav></>}</footer>
    </aside>
  </div>;
}
