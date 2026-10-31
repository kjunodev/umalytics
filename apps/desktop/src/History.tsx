import { useEffect, useRef, useState } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { useUiServices, type RequestedMatch } from '@umalytics/ui';
import type { HistoricalMatch } from '@umalytics/core/explorer/explorerTypes';
import type { EsportsTeamIconMap, PlayerProfileSummary, PlayerStatsScope } from '@umalytics/shared';
import { openDrafterUrl } from './externalLinks';
import { parseHistoryInput } from '@umalytics/core/explorer/explorerData';
import { Lobby } from './Live';
import { Draft } from './Draft';
import { Umas } from './Umas';
import { rememberMatch, restoreRecentMatches, type RecentMatch } from './recentMatches';

const store = () => load('history.json', { autoSave: false, defaults: {} });
export function History({ requestedMatch, scope, onOpenMatch, teamIcons }: { requestedMatch?: RequestedMatch; scope: PlayerStatsScope; onOpenMatch: (code: string) => void; teamIcons: EsportsTeamIconMap }) {
  const services = useUiServices();
  const [query, setQuery] = useState('');
  const [match, setMatch] = useState<HistoricalMatch>();
  const [scene, setScene] = useState<'Lobby' | 'Draft' | 'Umas'>('Draft');
  const [recent, setRecent] = useState<RecentMatch[]>([]);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(false);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, PlayerProfileSummary>>({});
  const [retry, setRetry] = useState(0);
  const recentRef = useRef<RecentMatch[]>([]);
  const storage = useRef<Awaited<ReturnType<typeof store>> | undefined>(undefined);
  const writing = useRef(Promise.resolve());
  const request = useRef<AbortController | undefined>(undefined);
  const loaded = useRef(false);
  const persist = (next: RecentMatch[]) => {
    recentRef.current = next; setRecent(next);
    writing.current = writing.current.catch(() => {}).then(async () => {
      const target = storage.current ?? await store(); await target.set('recent-matches-v1', next); await target.save();
    }).then(() => setSaveError('')).catch(() => setSaveError('Recently opened could not be saved.'));
  };
  useEffect(() => {
    let disposed = false;
    void store().then(async target => {
      storage.current = target; const saved = restoreRecentMatches(await target.get('recent-matches-v1'));
      if (!disposed && !loaded.current) { recentRef.current = saved; setRecent(saved); }
    }).catch(() => { if (!disposed) setSaveError('Recently opened could not be loaded.'); });
    return () => { disposed = true; request.current?.abort(); };
  }, []);
  const open = async (input: string) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setError(''); setLoading(true);
    try {
      const code = parseHistoryInput(input);
      try {
        if (!storage.current) storage.current = await store();
        if (!loaded.current) recentRef.current = restoreRecentMatches(await storage.current.get('recent-matches-v1'));
      } catch { setSaveError('Recently opened could not be loaded.'); }
      if (controller.signal.aborted) return;
      const next = await services.loadHistoricalMatch(code, controller.signal);
      if (controller.signal.aborted) return;
      setMatch(next); setQuery(code); setScene('Draft'); loaded.current = true;
      persist(rememberMatch(recentRef.current, { code, label: `${next.draft.teams.team1.name ?? 'Team 1'} vs ${next.draft.teams.team2.name ?? 'Team 2'}` }));
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Match unavailable.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  useEffect(() => { if (requestedMatch) void open(requestedMatch.code); }, [requestedMatch?.nonce]);
  useEffect(() => {
    const controller = new AbortController(); setProfiles({}); setProfilesLoading(!!match);
    if (match) {
      const update = (next: Record<string, PlayerProfileSummary>) => { if (!controller.signal.aborted) setProfiles(previous => ({ ...previous, ...next })); };
      void services.loadExplorerProfiles(match.roster.players, scope, update, controller.signal).then(update)
        .catch(() => { if (!controller.signal.aborted) setError('Some ranked profiles could not load.'); })
        .finally(() => { if (!controller.signal.aborted) setProfilesLoading(false); });
    }
    return () => controller.abort();
  }, [match, scope, retry]);
  return <section className="arena-data" aria-label="History">
    {(error || saveError) && <p role="alert">{error || saveError}</p>}
    {!match ? <>
      <section className="data-box"><h2>Review a completed draft</h2><form className="data-controls" onSubmit={e => { e.preventDefault(); void open(query); }}><input className="data-search" aria-label="Match code or URL" placeholder="TG7YT2 or https://drafter.uma.guide/matches/TG7YT2" value={query} onChange={e => setQuery(e.target.value)} maxLength={300}/><button disabled={loading}>{loading ? 'Loading…' : 'Load'}</button></form></section>
      <section className="data-box"><div className="data-heading"><h2>Recently opened</h2><span>Saved on this PC · {recent.length}/20</span><button disabled={!recent.length} onClick={() => { loaded.current = true; persist([]); }}>Clear recently opened</button></div><table className="quiet-table" aria-label="Recently opened matches"><thead><tr><th>Match</th><th className="table-text">Teams</th></tr></thead><tbody>{recent.map(m => <tr key={m.code} onClick={() => { void open(m.code); }}><th scope="row"><button className="text-link" disabled={loading} onClick={e => { e.stopPropagation(); void open(m.code); }}>{m.code}</button></th><td className="table-text">{m.label}</td></tr>)}</tbody></table>{!recent.length && <p className="muted">Open a match code here or from a player’s history to add it to this list.</p>}</section>
    </> : <>
      <header className="data-box match-heading"><button disabled={loading} onClick={() => { request.current?.abort(); setLoading(false); setMatch(undefined); setError(''); }}>← Matches</button><strong className="match-code">{match.matchCode}</strong><div><b><span className="team-blue">{match.draft.teams.team1.name}</span> vs <span className="team-orange">{match.draft.teams.team2.name}</span></b><small>{match.completedAt ? new Date(match.completedAt).toLocaleString() : 'Date not provided'} · {match.status} · {match.roster.players.length} players</small></div><a href={`https://drafter.uma.guide/matches/${encodeURIComponent(match.matchCode)}`} onClick={e => { e.preventDefault(); void openDrafterUrl(e.currentTarget.href).catch(() => setError('Unable to open Uma Drafter in the system browser.')); }}>Open in Uma Drafter ↗</a></header>
      {match.warnings.map(w => <p className="muted" key={w}>{w}</p>)}
      <div className="seg match-tabs" role="group" aria-label="Match view">{(['Lobby', 'Draft', 'Umas'] as const).map(tab => <button key={tab} aria-pressed={scene === tab} onClick={() => setScene(tab)}>{tab}</button>)}</div>
      {scene === 'Lobby' && <Lobby roster={match.roster} profiles={profiles} loading={profilesLoading} compact={false} scope={scope} emptyStatus="No historical roster" teamIcons={teamIcons} onOpenMatch={onOpenMatch} onRetry={() => setRetry(n => n + 1)}/>}
      {scene === 'Draft' && <Draft draft={match.draft}/>}
      {scene === 'Umas' && <Umas roster={match.roster} profiles={profiles} scope={scope}/>}
    </>}
  </section>;
}
