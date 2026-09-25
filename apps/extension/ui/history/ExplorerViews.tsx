import { useEffect, useRef, useState, type ComponentType } from 'react';
import './history.css';
import type { DraftSnapshot, PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchRoster } from '@umalytics/shared';
import { loadHistoricalMatch, loadExplorerProfiles } from '../../explorer/explorerClient';
import type { HistoricalMatch } from '../../explorer/explorerTypes';
import { mergeExplorerProfiles } from '../../explorer/explorerState';

type Profiles = Record<string, PlayerProfileSummary>;
type HistoryScene = ComponentType<{ snapshot: DraftSnapshot; roster: PrematchRoster; profiles: Profiles; statsScope: PlayerStatsScope; scene: 'lobby' | 'draft' | 'umas'; loading: boolean; navigation: number }>;

function useProfiles(players: PrematchPlayer[], scope: PlayerStatsScope) {
  const [profiles, setProfiles] = useState<Profiles>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const key = players.map(player => player.discordId).join('|');
  const previousContext = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    const context = `${scope}:${key}`;
    if (previousContext.current !== context) setProfiles({});
    previousContext.current = context;
    setError(''); setLoading(players.length > 0);
    if (players.length) {
      void loadExplorerProfiles(players, scope, next => { if (!controller.signal.aborted) setProfiles(previous => mergeExplorerProfiles(previous, next)); }, controller.signal)
        .then(next => {
          if (controller.signal.aborted) return;
          setProfiles(previous => mergeExplorerProfiles(previous, next));
          const errors = Object.values(next).filter(profile => profile.error);
          if (errors.length) setError(`${errors.length} ${errors.length === 1 ? 'profile could' : 'profiles could'} not be fully loaded. Available stats remain visible. Try again shortly.`);
        }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load profiles.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
    // Identity, scope, and explicit retry define a request; display-name changes do not refetch.
  }, [key, scope, attempt]);
  return { profiles, loading, error, retry: () => setAttempt(value => value + 1) };
}

const EMPTY_PLAYERS: PrematchPlayer[] = [];

export function HistoryView({ Scene, scene, scope, navigation, onMatchCodeChange }: { Scene: HistoryScene; scene: 'lobby' | 'draft' | 'umas'; scope: PlayerStatsScope; navigation: number; onMatchCodeChange: (code: string | undefined) => void }) {
  const [input, setInput] = useState('');
  const [match, setMatch] = useState<HistoricalMatch>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const { profiles, loading: profilesLoading, error: profileError, retry } = useProfiles(match?.roster.players ?? EMPTY_PLAYERS, scope);
  useEffect(() => () => request.current?.abort(), []);
  const load = async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); setMatch(undefined); onMatchCodeChange(undefined);
    try {
      const result = await loadHistoricalMatch(input, controller.signal);
      if (!controller.signal.aborted) { setMatch(result); onMatchCodeChange(result.matchCode); }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load match.');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };
  return <section className="explorer-view" aria-label="Match history">
    <form className="history-search" onSubmit={event => { event.preventDefault(); void load(); }}>
      <label htmlFor="history-match">Match code</label>
      <div className="explorer-input-row"><input id="history-match" value={input} onChange={event => setInput(event.target.value)} placeholder="TG7YT2 or https://drafter.uma.guide/matches/TG7YT2" maxLength={300} required spellCheck={false} />
        <button type="submit" disabled={!input.trim() || loading}>Load</button></div>
    </form>
    {loading && <p className="history-message" role="status">Loading completed draft…</p>}
    {error && <p className="explorer-error" role="alert">{error}</p>}
    {!match && !loading && !error && <section className="empty-state"><h2>Review a completed draft</h2><p>Enter a match code to see its saved maps, picks, and bans in the live draft layout.</p></section>}
    {match && <>
      {match.warnings.map(warning => <p className="history-message" role="status" key={warning}>{warning}</p>)}
      {profilesLoading && <p className="history-message" role="status">Loading current player stats… The completed draft is ready.</p>}
      {profileError && <p className="explorer-error" role="status">{profileError} <button type="button" disabled={profilesLoading} onClick={retry}>Retry stats</button></p>}
      <div className="history-scene"><Scene key={match.matchCode} snapshot={match.draft} roster={match.roster} profiles={profiles} statsScope={scope} scene={scene} loading={profilesLoading} navigation={navigation} /></div>
    </>}
  </section>;
}
