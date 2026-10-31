import { phaseLabel } from './phase';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { isDiscordSnowflake } from '@umalytics/core/room/rosterIdentity';
import { normalizeRosterForDisplay } from '@umalytics/core/room/rosterDisplay';
import { PlayersView, HistoryView, HistoricalScene, UmasScene, useUiServices, type RequestedMatch, type AppScene } from '@umalytics/ui';
import type { PlayerProfileSummary, PlayerStatsScope } from '@umalytics/shared';
import { DesktopRoom, feedDiagnostics, type FeedEnvelope, type FeedStatus } from './feed';
import { Stamina } from './Stamina';
import { Lobby } from './Live';
import { Draft } from './Draft';
import { RailIcon } from './RailIcon';
import { preferences, savePreferences, type Page } from './preferences';

function Logo() {
  return <svg width="24" height="24" viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="7" stroke="var(--accent-blue)" strokeWidth="2"/><path d="M8 17V9m5 8v-5m5 5v-8" stroke="var(--accent-orange)" strokeWidth="2.2" strokeLinecap="round"/></svg>;
}

export function App() {
  const { loadExplorerProfiles } = useUiServices();
  const [page, setPage] = useState<Page>(preferences.page);
  const [compactMode, setCompactMode] = useState(preferences.compact);
  const [narrow, setNarrow] = useState(window.innerWidth < preferences.compactThreshold);
  const [pinned, setPinned] = useState(preferences.pinned);
  const [windowBusy, setWindowBusy] = useState(false);
  const [shellError, setShellError] = useState('');
  const room = useRef(new DesktopRoom());
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<FeedStatus>();
  const [feedError, setFeedError] = useState('');
  const [feedBusy, setFeedBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [lastUpdate, setLastUpdate] = useState<number>();
  const [profileError, setProfileError] = useState('');
  const [scope, setScope] = useState<PlayerStatsScope>('currentSeason');
  const [profiles, setProfiles] = useState<Record<string, PlayerProfileSummary>>({});
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [historyScene, setHistoryScene] = useState<AppScene>('draft');
  const [requestedMatch, setRequestedMatch] = useState<RequestedMatch>();
  const [refresh, setRefresh] = useState(0);
  const viewState = status?.state === 'disconnected' && !room.current.state.matchCode ? room.current.lastState ?? room.current.state : room.current.state;
  const roster = normalizeRosterForDisplay(viewState.roster);
  const draft = viewState.draft;
  const code = viewState.matchCode;
  const pickOrder = viewState === room.current.lastState ? room.current.lastPickOrder : room.current.pickOrder;
  const compact = compactMode || narrow;
  const livePage = page === 'Draft' ? 'Draft' : 'Lobby';
  const displayedPage = compact ? livePage : page;
  const profileRoster = room.current.state.roster ?? room.current.lastState?.roster;
  const rosterKey = JSON.stringify([room.current.state.matchCode ?? room.current.lastState?.matchCode, profileRoster?.players]);
  const feedLabel = status?.state === 'port-in-use' ? 'Port 38917 in use' : status?.state === 'error' ? 'Feed unavailable' :
    status?.state === 'connected' ? 'Live' : status?.state === 'disconnected' ? 'Disconnected' : 'Waiting for Uma Drafter';
  const feedBlocked = status?.state === 'port-in-use';
  const disconnected = status?.state === 'disconnected' && !!(roster?.players.length || draft);
  const liveView = displayedPage === 'Lobby' || displayedPage === 'Draft';

  useEffect(() => {
    const query = window.matchMedia(`(width < ${preferences.compactThreshold}px)`);
    const changed = () => setNarrow(query.matches);
    query.addEventListener('change', changed);
    const win = getCurrentWindow();
    void (async () => {
      await win.setAlwaysOnTop(preferences.pinned);
      if (preferences.compact) await win.setSize(new LogicalSize(440, 860));
    })().catch(() => setShellError('Unable to restore window preferences.'));
    return () => query.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisten: UnlistenFn[] = [];
    const subscribe = async () => {
      const message = await listen<FeedEnvelope>('feed-message', ({ payload }) => {
        room.current.apply(payload);
        if (!('type' in payload)) setLastUpdate(Date.now());
        setRevision(value => value + 1);
      });
      if (disposed) { message(); return; } unlisten.push(message);
      const state = await listen<FeedStatus>('feed-status', ({ payload }) => setStatus(payload));
      if (disposed) { state(); return; } unlisten.push(state);
      const started = await invoke<FeedStatus>('start_feed');
      if (!disposed) setStatus(started);
    };
    void subscribe().catch(() => { if (!disposed) setFeedError('Unable to start the local feed listener.'); });
    return () => { disposed = true; unlisten.forEach(stop => stop()); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const players = profileRoster?.players.filter(player => isDiscordSnowflake(player.discordId)) ?? [];
    if (players.length) { setProfiles({}); setProfileError(''); }
    setProfilesLoading(players.length > 0);
    const update = (next: Record<string, PlayerProfileSummary>) => {
      if (!controller.signal.aborted) setProfiles(previous => ({ ...previous, ...next }));
    };
    if (players.length) void loadExplorerProfiles(players, scope, update, controller.signal)
      .then(next => {
        update(next);
        if (!controller.signal.aborted && Object.values(next).some(profile => profile.error)) setProfileError('Some profiles could not be fully loaded. Available stats remain visible.');
      })
      .catch(error => { if (!controller.signal.aborted) setProfileError(error instanceof Error ? error.message : 'Profile loading failed. Retry when the API is available.'); })
      .finally(() => { if (!controller.signal.aborted) setProfilesLoading(false); });
    return () => controller.abort();
    // Metadata-only feed events do not restart the same profile requests.
  }, [rosterKey, scope, refresh]);

  const persist = (patch: Parameters<typeof savePreferences>[0]) => {
    void savePreferences(patch).catch(() => setShellError('Unable to save preferences.'));
  };
  const navigate = (next: Page) => { setPage(next); persist({ page: next }); };
  const openMatch = (code: string) => {
    setRequestedMatch({ code, nonce: Date.now() });
    setHistoryScene('draft');
    navigate('History');
    if (compact) void toggleMode();
  };
  const toggleMode = async () => {
    setWindowBusy(true); setShellError('');
    try {
      const win = getCurrentWindow();
      if (compact) {
        await win.setSize(new LogicalSize(preferences.fullSize.width, preferences.fullSize.height));
        setCompactMode(false); persist({ compact: false });
      } else {
        const size = (await win.innerSize()).toLogical(await win.scaleFactor());
        await win.setSize(new LogicalSize(440, 860));
        setCompactMode(true); persist({ compact: true, fullSize: { width: size.width, height: size.height } });
      }
    } catch { setShellError('Unable to resize the window.'); }
    finally { setWindowBusy(false); }
  };
  const togglePin = async () => {
    setWindowBusy(true);
    try { await getCurrentWindow().setAlwaysOnTop(!pinned); setPinned(!pinned); persist({ pinned: !pinned }); }
    catch { setShellError('Unable to change pin on top.'); }
    finally { setWindowBusy(false); }
  };
  const retryFeed = async () => {
    setFeedBusy(true); setFeedError('');
    try { setStatus(await invoke<FeedStatus>('start_feed')); }
    catch { setFeedError('Unable to start the local feed listener.'); }
    finally { setFeedBusy(false); }
  };
  const copyDiagnostics = async () => {
    try { await navigator.clipboard.writeText(feedDiagnostics(status)); setCopyStatus('Diagnostics copied'); }
    catch { setCopyStatus('Unable to copy diagnostics.'); }
  };
  const feedBox = <div className={`feed-status ${status?.state === 'connected' ? 'connected' : ''}`} role="status"><i className={status?.state === 'connected' ? 'live-dot' : 'idle-dot'}/><span>{feedLabel}{code && <> · Room <b className="num">{code}</b></>}</span></div>;
  const navItem = (name: Page) => <button key={name} className="nav-item" aria-label={name} title={name} aria-current={page === name ? 'page' : undefined} onClick={() => navigate(name)}><RailIcon page={name}/><span>{name}</span><span className="rail-tooltip" role="tooltip">{name}</span></button>;

  return <div className={`app-shell desktop-shell ${compact ? 'compact' : ''}`} data-revision={revision}>
    {!compact && <nav className="sidebar" aria-label="Sections"><div className="brand" title="UmaLytics"><Logo/></div>
      <div className="rail-group" role="group" aria-label="Live">{(['Lobby', 'Draft'] as const).map(navItem)}</div>
      <div className="rail-group" role="group" aria-label="Tools">{navItem('Stamina')}</div>
      <div className="rail-group" role="group" aria-label="Data">{(['Players', 'History', 'Umas'] as const).map(navItem)}</div>
      <div className="sidebar-bottom"><span className="rail-feed" role="status" aria-label={feedLabel} title={feedLabel}><i className={status?.state === 'connected' ? 'live-dot' : 'idle-dot'}/></span>{navItem('Settings')}</div></nav>}
    <div className="workspace">
      {compact ? <header className="compact-header"><Logo/><div className="seg" role="group" aria-label="View">{(['Lobby', 'Draft'] as const).map(name => <button key={name} aria-pressed={livePage === name} onClick={() => navigate(name)}>{name}</button>)}</div>
        <span className="compact-room num" title={feedLabel}><i className={status?.state === 'connected' ? 'live-dot' : 'idle-dot'}/>{code ?? 'No room'}</span>
        <button className="icon-button" aria-label="Pin on top" aria-pressed={pinned} disabled={windowBusy} onClick={() => { void togglePin(); }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h4l-.5 4 2.5 2v1H4V8l2.5-2L6 2zM8 9v5"/></svg></button>
        <button className="icon-button" aria-label="Expand to full mode" disabled={windowBusy} onClick={() => { void toggleMode(); }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/></svg></button>
      </header> : <header className="page-header"><h1>{page === 'Stamina' ? 'Stamina check' : page}</h1><span className="subtitle">{page === 'Stamina' ? 'Full spurt and survival' : page === 'Lobby' ? code ? `${roster?.players.length ?? 0} players · ${phaseLabel(draft?.phase)}` : 'Waiting for a live room' : page === 'Draft' ? phaseLabel(draft?.phase) : ''}</span>
        <div className="page-actions">{feedBox}{['Lobby', 'Draft', 'Players', 'History', 'Umas'].includes(page) && <div className="seg" role="group" aria-label="Stats scope">{(['currentSeason', 'allTime'] as const).map(value => <button key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>{value === 'currentSeason' ? 'Season' : 'All-time'}</button>)}</div>}
        <button disabled={windowBusy} onClick={() => { void toggleMode(); }}>Compact</button></div></header>}
      <main className="content">
        {shellError && <div className="feed-banner error" role="alert">{shellError}</div>}
        {liveView && !feedBlocked && (feedError || status?.state === 'error') && <div className="feed-banner error" role="alert"><b>{feedError || 'Feed unavailable. Available data remains visible.'}</b><button disabled={feedBusy} onClick={() => { void retryFeed(); }}>Retry feed</button></div>}
        {liveView && !feedBlocked && profileError && <div className="feed-banner error" role="alert"><span>{profileError}</span><button disabled={profilesLoading} onClick={() => setRefresh(value => value + 1)}>Retry stats</button></div>}
        {liveView && feedBlocked ? <section className="empty-state port-error" role="alert"><h2>Local feed port is in use</h2><p>UmaLytics could not listen on 127.0.0.1:38917. Close another running UmaLytics window or the app using this port, then retry.</p><div><button disabled={feedBusy} onClick={() => { void retryFeed(); }}>Retry</button><button onClick={() => { void copyDiagnostics(); }}>Copy diagnostics</button></div><p role="status">{copyStatus}</p></section> : liveView && <>
          {disconnected && <div className="feed-banner reconnect" role="status"><b>Uma Drafter disconnected.</b><span>Showing the last {displayedPage === 'Lobby' ? 'roster' : 'draft'}{lastUpdate ? ` received at ${new Date(lastUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}. Reconnecting automatically.</span></div>}
          <div className={disconnected ? 'live-content dimmed' : 'live-content'}>
            {displayedPage === 'Lobby' && <Lobby roster={roster} profiles={profiles} loading={profilesLoading} compact={compact} scope={scope} emptyStatus={feedLabel} onOpenMatch={openMatch} onRetry={() => setRefresh(value => value + 1)}/>}
            {displayedPage === 'Draft' && <Draft draft={draft?.phase === 'lobby' ? undefined : draft} pickOrder={pickOrder} loading={status?.state === 'connected' && !draft}/>}
          </div>
        </>}
        <div className="desktop-tool" hidden={displayedPage !== 'Stamina'}><Stamina draft={draft}/></div>
        <div hidden={displayedPage !== 'Players'}><PlayersView roster={roster} statsScope={scope} active={displayedPage === 'Players'} onOpenMatch={openMatch}/></div>
        {displayedPage === 'History' && <>
          <div className="history-tabs seg" role="group" aria-label="History view">{(['lobby', 'draft', 'umas'] as const).map(scene => <button key={scene} aria-pressed={historyScene === scene} onClick={() => setHistoryScene(scene)}>{scene === 'lobby' ? 'Lobby' : scene === 'draft' ? 'Draft' : 'Umas'}</button>)}</div>
          <HistoryView Scene={HistoricalScene} scene={historyScene} scope={scope} navigation={0} onMatchCodeChange={() => {}} requestedMatch={requestedMatch}/>
        </>}
        {displayedPage === 'Umas' && <UmasScene roster={roster ?? { players: [] }} profiles={profiles} statsScope={scope}/>}
        {displayedPage === 'Settings' && <section className="panel desktop-tool"><h2>Settings</h2><button aria-pressed={pinned} disabled={windowBusy} onClick={() => { void togglePin(); }}>Pin on top: {pinned ? 'On' : 'Off'}</button>
          {import.meta.env.DEV && <details><summary>Debug feed</summary>{feedBox}<p>Accepted {status?.accepted ?? 0} · rejected {status?.rejected ?? 0}</p><pre>{JSON.stringify({ room: code, draft }, null, 2)}</pre></details>}</section>}
      </main>
    </div>
  </div>;
}
