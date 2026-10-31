import { useEffect, useState } from 'react';
import { useUiServices } from '@umalytics/ui';
import type { PlayerProfileSummary, PrematchPlayer } from '@umalytics/shared';
import type { SeasonLeaderboard } from '@umalytics/core/profiles/playerProfileApi';
import { classifyPlayerQuery, filterLeaderboardEntries, formatLeaderboardRecord, formatLeaderboardWinRate, leaderboardDisplayRating, leaderboardEntryToPlayer } from '@umalytics/ui/players/playersData';
import { lookupPlayer } from '@umalytics/core/explorer/explorerData';
import { formatDecimal, formatNumber } from '@umalytics/ui/common/format';
import { PlayerDrawer, usePlayerProfile } from './PlayerDrawer';

export function Players({ onOpenMatch }: { onOpenMatch: (code: string) => void }) {
  const services = useUiServices();
  const [board, setBoard] = useState<SeasonLeaderboard>();
  const [profiles, setProfiles] = useState<Record<string, PlayerProfileSummary>>({});
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PrematchPlayer>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [directory, setDirectory] = useState<PrematchPlayer[]>();
  const [searching, setSearching] = useState(false);
  const { profile, loading } = usePlayerProfile(selected, 'currentSeason');
  useEffect(() => {
    const controller = new AbortController(); setError('');
    void services.loadSeasonLeaderboard(controller.signal).then(data => { if (!controller.signal.aborted) setBoard(data); }).catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    return () => controller.abort();
  }, [attempt]);
  const classification = classifyPlayerQuery(query);
  const filtered = filterLeaderboardEntries(board?.entries ?? [], query);
  const rows = filtered.slice((page - 1) * 20, page * 20);
  const rowKey = rows.map(e => e.userId).join(',');
  useEffect(() => {
    if (!rows.length) return;
    const controller = new AbortController();
    const update = (next: Record<string, PlayerProfileSummary>) => { if (!controller.signal.aborted) setProfiles(previous => ({ ...previous, ...next })); };
    void services.loadExplorerProfiles(rows.map(leaderboardEntryToPlayer), 'currentSeason', update, controller.signal).then(update).catch(() => {});
    return () => controller.abort();
  }, [rowKey]);
  useEffect(() => { setPage(1); setDirectory(undefined); setSearching(false); }, [query]);
  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    void services.searchPlayers(query, 1, controller.signal).then(result => { if (!controller.signal.aborted) { setDirectory(result.players); setSearching(false); } }).catch(e => { if (!controller.signal.aborted) { setError(String(e)); setSearching(false); } });
    return () => controller.abort();
  }, [searching, query]);
  return <section className="arena-data" aria-label="Players">
    <input className="data-search" type="search" aria-label="Search players" placeholder="Search the leaderboard, or paste a profile URL or Discord ID" value={query} maxLength={300} onChange={e => setQuery(e.target.value)}/>
    <section className="data-box"><div className="data-heading"><h2>Season leaderboard</h2><span>{board?.activeSeasonName ?? 'Current season'} · {filtered.length} players</span></div>
      {error && <p role="alert">{error} <button onClick={() => setAttempt(v => v + 1)}>Retry</button></p>}
      {!board && !error && <p role="status">Loading leaderboard…</p>}
      {classification.mode === 'lookup' ? <button onClick={() => setSelected(lookupPlayer(classification.id))}>Open profile</button> : <>
      <table className="quiet-table" aria-label="Season leaderboard"><thead><tr>{['Rank', 'Player', 'Rating', 'W–L', 'Win %', 'PPG', 'MVP'].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{rows.map(e => {
        const p = profiles[e.userId]; const stats = p?.statsPrivate ? undefined : p?.currentSeasonStats ?? p;
        return <tr key={e.userId} onClick={() => setSelected(leaderboardEntryToPlayer(e))}><td>#{e.rank}</td><th scope="row"><button className="table-player" onClick={() => setSelected(leaderboardEntryToPlayer(e))}>{e.displayName ?? 'Player'}</button></th><td>{formatNumber(leaderboardDisplayRating(e))}</td><td>{formatLeaderboardRecord(e)}</td><td>{formatLeaderboardWinRate(e)}</td><td>{formatDecimal(stats?.pointsPerGame)}</td><td>{formatNumber(stats?.mvpMatches)}</td></tr>;
      })}</tbody></table>
      {!rows.length && board && <div className="data-empty"><p>No ranked players match this search.</p><button disabled={searching} onClick={() => { setError(''); setSearching(true); }}>{searching ? 'Searching…' : 'Search all players'}</button>{directory?.map(p => <button key={p.discordId} onClick={() => setSelected(p)}>{p.displayName}</button>)}</div>}
      <nav className="data-pager" aria-label="Leaderboard pages"><button aria-label="Previous players" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button><span>Page {page} of {Math.max(1, Math.ceil(filtered.length / 20))}</span><button aria-label="Next players" disabled={page * 20 >= filtered.length} onClick={() => setPage(page + 1)}>›</button></nav>
      </>}
    </section>
    {selected && <PlayerDrawer key={`${selected.discordId}:currentSeason`} player={selected} profile={profile} loading={loading} scope="currentSeason" onClose={() => setSelected(undefined)} onOpenMatch={onOpenMatch}/>}
  </section>;
}
