import { useEffect, useRef, useState, type ComponentType } from 'react';
import './history.css';
import type { DraftSnapshot, PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchRoster, PrematchTeam } from '@umalytics/shared';
import { loadHistoricalMatch, loadExplorerProfiles, searchPlayers } from '../../explorer/explorerClient';
import type { HistoricalMatch, PlayerSearchResult } from '../../explorer/explorerTypes';
import { mergeExplorerProfiles } from '../../explorer/explorerState';

type Profiles = Record<string, PlayerProfileSummary>;
type HistoryScene = ComponentType<{ snapshot: DraftSnapshot; roster: PrematchRoster; profiles: Profiles; statsScope: PlayerStatsScope; scene: 'lobby' | 'draft' | 'umas'; loading: boolean; navigation: number }>;
type DetailView = ComponentType<{ team?: PrematchTeam; player: PrematchPlayer; profile?: PlayerProfileSummary; isProfileLoading: boolean; statsScope: PlayerStatsScope; now: number; onBack: () => void; backLabel?: string }>;

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

export function HistoryView({ Scene, scene, scope, navigation }: { Scene: HistoryScene; scene: 'lobby' | 'draft' | 'umas'; scope: PlayerStatsScope; navigation: number }) {
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
    setLoading(true); setError(''); setMatch(undefined);
    try {
      const result = await loadHistoricalMatch(input, controller.signal);
      if (!controller.signal.aborted) setMatch(result);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load match.');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };
  return <section className="explorer-view" aria-label="Match history">
    <form className="explorer-search" onSubmit={event => { event.preventDefault(); void load(); }}>
      <label htmlFor="history-match">Match code or match URL</label>
      <div className="explorer-input-row"><input id="history-match" value={input} onChange={event => setInput(event.target.value)} placeholder="TG7YT2 or https://drafter.uma.guide/matches/TG7YT2" maxLength={300} required spellCheck={false} />
        <button type="submit" disabled={!input.trim()}>Load draft</button></div>
    </form>
    {loading && <p role="status">Loading completed draft…</p>}
    {error && <p className="explorer-error" role="alert">{error}</p>}
    {!match && !loading && !error && <section className="empty-state"><h2>Review a completed draft</h2><p>Enter a match code to see its saved maps, picks, and bans in the live draft layout.</p></section>}
    {match && <>
      <div className="explorer-context"><div><h2>Historical match · {match.matchCode}</h2>
        <p>Completed draft · <a href={`https://drafter.uma.guide/matches/${match.matchCode}`} target="_blank" rel="noreferrer">Open match on Uma Drafter</a></p>
        <p>Player statistics are current, not snapshots from the date of this match.</p></div>
        </div>
      {match.warnings.map(warning => <p role="status" key={warning}>{warning}</p>)}
      {profilesLoading && <p role="status">Loading current player stats… The completed draft is ready.</p>}
      {profileError && <p className="explorer-error" role="status">{profileError} <button type="button" disabled={profilesLoading} onClick={retry}>Retry stats</button></p>}
      <Scene key={match.matchCode} snapshot={match.draft} roster={match.roster} profiles={profiles} statsScope={scope} scene={scene} loading={profilesLoading} navigation={navigation} />
    </>}
  </section>;
}

export function ProfilesView({ Detail, scope }: { Detail: DetailView; scope: PlayerStatsScope }) {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [results, setResults] = useState<PlayerSearchResult>();
  const [selected, setSelected] = useState<PrematchPlayer>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const { profiles, loading: profileLoading, error: profileError, retry } = useProfiles(selected ? [selected] : EMPTY_PLAYERS, scope);
  useEffect(() => () => request.current?.abort(), []);
  const search = async (query: string, page = 1) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); setSelected(undefined); setResults(undefined); setSubmitted(query);
    try {
      const found = await searchPlayers(query, page, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found);
      if (found.total === 1) setSelected(found.players[0]);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to search players.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  return <section className="explorer-view" aria-label="Single player lookup">
    <form className="explorer-search" onSubmit={event => { event.preventDefault(); void search(input); }}>
      <label htmlFor="profile-search">Player name, Discord ID, or profile URL</label>
      <div className="explorer-input-row"><input id="profile-search" value={input} onChange={event => setInput(event.target.value)} placeholder="Search for a player" maxLength={300} required spellCheck={false} />
        <button type="submit" disabled={!input.trim()}>Find player</button></div>
    </form>
    {loading && <p role="status">Searching players…</p>}
    {error && <p className="explorer-error" role="alert">{error}</p>}
    {!results && !loading && !error && <section className="empty-state"><h2>Look up a player</h2><p>View a player's detailed stats without joining their lobby.</p></section>}
    {results && !selected && <>
      <p role="status">{results.total ? `${results.total} matching players. Choose a profile below.` : 'No players found. Try their Discord username or exact ID.'}</p>
      {results.total >= 50 && <p>Showing up to 50 directory matches. Refine your search if the player is missing.</p>}
      <ul className="explorer-results">{results.players.map(player => <li key={player.discordId}>
        <button type="button" onClick={() => setSelected(player)}><strong>{player.displayName}</strong><span>{player.discordId}</span><span>View profile</span></button>
      </li>)}</ul>
      {results.total > results.pageSize && <nav className="explorer-pagination" aria-label="Player search pages">
        <button type="button" disabled={results.page <= 1} onClick={() => void search(submitted, results.page - 1)}>Previous</button>
        <span>Page {results.page} of {Math.ceil(results.total / results.pageSize)}</span>
        <button type="button" disabled={results.page * results.pageSize >= results.total} onClick={() => void search(submitted, results.page + 1)}>Next</button>
      </nav>}
    </>}
    {selected && <>
      <div className="explorer-context"><p>Current player stats</p></div>
      {profileLoading && <p role="status">Loading player details…</p>}
      {profileError && <p className="explorer-error" role="status">{profileError} <button type="button" disabled={profileLoading} onClick={retry}>Retry stats</button></p>}
      <Detail player={selected} profile={profiles[selected.discordId]} isProfileLoading={profileLoading} statsScope={scope} now={Date.now()} backLabel="Back to search" onBack={() => setSelected(undefined)} />
    </>}
  </section>;
}

