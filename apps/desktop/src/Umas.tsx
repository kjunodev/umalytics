import { useRef, useState } from 'react';
import type { PlayerProfileSummary, PlayerStatsScope, PrematchRoster } from '@umalytics/shared';
import { getTeamGroups } from '@umalytics/core/room/rosterDisplay';
import { UmaImage } from '@umalytics/ui/common/UmaImage';
import { formatDecimal, formatPercent } from '@umalytics/ui/common/format';
import { missingUmaHistoryLabel } from '@umalytics/core/profiles/profileAvailability';
import { filterUmaCatalogOptions, findScopedUmaEntry, getUmaCatalogAction, getUmaCatalogOptions, getUmaHistoryCounts, sortUmaCatalogOptions, type UmaCatalogSortMode, type UmaCatalogHitScope } from '@umalytics/ui/umas/umaCatalog';

export function Umas({ roster, profiles, scope, compact = false }: { roster: PrematchRoster; profiles: Record<string, PlayerProfileSummary>; scope: PlayerStatsScope; compact?: boolean }) {
  const [query, setQuery] = useState(''), [sort, setSort] = useState<UmaCatalogSortMode>('lobbyHits'), [teamScope, setTeamScope] = useState<UmaCatalogHitScope>('all'), [selected, setSelected] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const catalog = getUmaCatalogOptions(profiles, scope);
  const players = roster.players.filter(p => teamScope === 'all' || p.team === teamScope);
  const hits = getUmaHistoryCounts(catalog, players, profiles, scope);
  const options = sortUmaCatalogOptions(filterUmaCatalogOptions(catalog, query), sort, hits);
  const uma = options.find(u => u.umaId === selected) ?? options[0];
  const action = uma && getUmaCatalogAction(uma);
  const move = (delta: number) => {
    const index = options.findIndex(u => u.umaId === uma?.umaId);
    const next = options[Math.max(0, Math.min(options.length - 1, index + delta))];
    if (!next) return;
    setSelected(next.umaId);
    const button = list.current?.querySelector<HTMLButtonElement>(`[data-uma-id="${next.umaId}"]`);
    button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: 'nearest' });
  };
  return <section className={`arena-data arena-umas-layout ${compact ? 'compact-umas' : ''} ${detailOpen ? 'show-uma-detail' : ''}`} aria-label="Uma catalog">
    <section className="data-box uma-catalog-local"><div className="data-heading"><h2>Uma catalog</h2><span>{options.length} Umas · ranked stats</span></div>
      <input className="data-search" type="search" aria-label="Search Umas" placeholder="Search Umas" value={query} onChange={e => setQuery(e.target.value)}/>
      <div className="data-controls"><div className="seg" role="group" aria-label="Sort Uma catalog">{([['lobbyHits', 'Most played'], ['releaseOrder', 'Release'], ['alphabetical', 'A–Z']] as const).map(([value, label]) => <button key={value} aria-pressed={sort === value} onClick={() => setSort(value)}>{label}</button>)}</div><div className="seg" role="group" aria-label="Catalog hit scope">{(['all', 'team1', 'team2'] as const).map((v, i) => <button key={v} aria-pressed={teamScope === v} onClick={() => setTeamScope(v)}>{i ? `Team ${i}` : 'All'}</button>)}</div></div>
      <div className="arena-uma-catalog" role="listbox" aria-label="Umas" ref={list} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); } }}>{options.map(u => <button key={u.umaId} role="option" data-uma-id={u.umaId} aria-selected={u.umaId === uma?.umaId} tabIndex={u.umaId === uma?.umaId ? 0 : -1} onClick={() => { setSelected(u.umaId); setDetailOpen(true); }}><span className="uma-list-portrait"><UmaImage imageUrl={u.imageUrl} name={u.name}/></span><b>{u.name}</b><small>{hits.get(u.umaId) ?? 0} in lobby</small></button>)}</div>{!options.length && <p>No matching Umas.</p>}
    </section>
    {uma && action && <aside className="data-box uma-team-stats" aria-label={`${uma.name} lobby history`}>{compact && <button className="umas-back" onClick={() => { setDetailOpen(false); requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true })); }}>← Umas</button>}<div className="data-heading"><UmaImage imageUrl={uma.imageUrl} name={uma.name}/><h2>{uma.name}</h2></div><p className="muted">{scope === 'currentSeason' ? 'Season' : 'All-time'} ranked Uma stats</p>{getTeamGroups(roster).map((team, i) => <section key={team.id} className={`team-${i + 1}`}><h3>{team.name ?? `Team ${i + 1}`}</h3><table className="quiet-table" aria-label={`${team.name ?? team.id} Uma stats`}><thead><tr><th>Player</th><th>GP</th><th>WR</th><th>PPG</th></tr></thead><tbody>{team.players.map(p => {
      const profile = profiles[p.discordId]; const entry = profile?.statsPrivate ? undefined : findScopedUmaEntry(action, profile, scope);
      return <tr key={p.discordId}><th scope="row">{profile?.displayName ?? p.displayName}</th>{entry ? <><td>{entry.matches}</td><td>{formatPercent(entry.winRate)}</td><td>{formatDecimal(entry.pointsPerGame)}</td></> : <td className="table-text" colSpan={3}>{missingUmaHistoryLabel(profile, scope)}</td>}</tr>;
    })}</tbody></table></section>)}</aside>}
  </section>;
}
