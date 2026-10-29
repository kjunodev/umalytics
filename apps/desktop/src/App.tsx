import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { fetchPlayerProfileSummaries } from '@umalytics/core/profiles/playerProfileApi';
import { isDiscordSnowflake } from '@umalytics/core/room/rosterIdentity';
import type { PlayerProfileSummary, PlayerStatsScope } from '@umalytics/shared';
import { DesktopRoom, type FeedEnvelope, type FeedStatus } from './feed';
import { Stamina } from './Stamina';

export function App() {
  const [view, setView] = useState<'feed' | 'stamina'>('feed');
  const room = useRef(new DesktopRoom());
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<FeedStatus>();
  const [error, setError] = useState('');
  const [scope, setScope] = useState<PlayerStatsScope>('currentSeason');
  const [profiles, setProfiles] = useState<Record<string, PlayerProfileSummary>>({});
  const [refresh, setRefresh] = useState(0);
  const roster = room.current.state.roster;
  const draft = room.current.state.draft;
  // Metadata-only events should not cancel and restart the same stats requests.
  const rosterKey = JSON.stringify([room.current.state.matchCode, roster?.players]);

  useEffect(() => {
    let disposed = false;
    const unlisten: UnlistenFn[] = [];
    const subscribe = async () => {
      unlisten.push(await listen<FeedEnvelope>('feed-message', ({ payload }) => {
        room.current.apply(payload);
        setRevision(value => value + 1);
      }));
      unlisten.push(await listen<FeedStatus>('feed-status', ({ payload }) => setStatus(payload)));
      if (!disposed) setStatus(await invoke<FeedStatus>('start_feed'));
    };
    void subscribe().catch(() => { if (!disposed) setError('Unable to start the local feed listener.'); })
      .finally(() => { if (disposed) unlisten.forEach(stop => stop()); });
    return () => { disposed = true; unlisten.forEach(stop => stop()); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setProfiles({});
    setError('');
    const players = roster?.players.filter(player => isDiscordSnowflake(player.discordId)) ?? [];
    const update = (summary: PlayerProfileSummary) => {
      if (!controller.signal.aborted) setProfiles(previous => ({ ...previous, [summary.discordId]: summary }));
    };
    void fetchPlayerProfileSummaries(players, { scope, signal: controller.signal, onProgress: update, onSummary: update })
      .catch(() => { if (!controller.signal.aborted) setError('Profile loading failed. Retry when the API is available.'); });
    return () => controller.abort();
    // rosterKey contains all player metadata consumed by core.
  }, [rosterKey, scope, refresh]);

  return <main data-revision={revision}>
    <h1>UmaLytics desktop</h1>
    <nav aria-label="Desktop views">
      <button aria-pressed={view === 'feed'} onClick={() => setView('feed')}>Debug feed</button>
      <button aria-pressed={view === 'stamina'} onClick={() => setView('stamina')}>Stamina</button>
    </nav>
    <div hidden={view !== 'stamina'}><Stamina /></div>
    <div hidden={view !== 'feed'}>
    <p role="status">Feed: {status?.state ?? 'starting'} · accepted {status?.accepted ?? 0} · rejected {status?.rejected ?? 0}</p>
    {status?.state === 'port-in-use' && <p role="alert">Port 38917 is in use. Close the other listener and restart UmaLytics.</p>}
    <p>Room: {room.current.state.matchCode ?? 'none'} · Draft phase: {draft?.phase ?? 'none'}</p>
    <label>Stats scope <select value={scope} onChange={event => setScope(event.target.value as PlayerStatsScope)}>
      <option value="currentSeason">Current season</option><option value="allTime">All time</option>
    </select></label> <button onClick={() => setRefresh(value => value + 1)}>Reload stats</button>
    {error && <p role="alert">{error}</p>}
    <div className="teams">{(['team1', 'team2'] as const).map(team => {
      const actions = draft?.teams[team].umas ?? [];
      return <section key={team}>
        <h2>{roster?.teams?.[team].name ?? draft?.teams[team].name ?? team}</h2>
        <p>Uma picks: {actions.filter(action => action.kind === 'pick').length} · bans: {actions.filter(action => action.kind !== 'pick').length}</p>
        <p>Map picks: {draft?.teams[team].maps.filter(map => map.status === 'selected').length ?? 0} · bans: {draft?.teams[team].maps.filter(map => map.status === 'vetoed').length ?? 0}</p>
        <ul>{roster?.players.filter(player => player.team === team).map(player => {
          const profile = profiles[player.discordId];
          return <li key={player.discordId}><strong>{player.displayName}</strong><br />{
            !isDiscordSnowflake(player.discordId) ? 'No linked profile' : !profile ? 'Loading stats…' :
            profile.statsPrivate ? 'Stats are private' : profile.error ? 'Stats unavailable' :
            `W–L ${profile.wins ?? '—'}–${profile.losses ?? '—'} · PPG ${profile.pointsPerGame?.toFixed(2) ?? '—'} · matches ${profile.matches ?? '—'}`
          }</li>;
        })}</ul>
      </section>;
    })}</div>
    </div>
  </main>;
}
