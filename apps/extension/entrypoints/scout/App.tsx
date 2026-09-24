import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import type {
  DraftSnapshot,
  PlayerStatsScope,
  PrematchRoster
} from '@umalytics/shared';
import { getRefreshCooldownMs, latestStatsCheckAt } from '../../profiles/profileTiming';
import { getTeamGroups, normalizeRosterForDisplay } from '../../room/rosterDisplay';
import {
  getPlayerProfileSummaries,
  PLAYER_PROFILE_SUMMARIES_STORAGE_KEY
} from '../../storage/profileStorage';
import type { PlayerProfileSummariesSnapshot } from '../../profiles/profileTypes';
import {
  getLatestDraftSnapshot,
  LATEST_DRAFT_SNAPSHOT_STORAGE_KEY
} from '../../storage/draftStorage';
import {
  getLatestPrematchRoster,
  LATEST_PREMATCH_ROSTER_STORAGE_KEY
} from '../../storage/rosterStorage';
import {
  clearLobbyLockState,
  getLobbyLockState,
  LOBBY_LOCK_STORAGE_KEY,
  setLobbyLockState,
  type LobbyLockState
} from '../../storage/lobbyLockStorage';
import { sendLobbyReconnectRequest, sendProfileRefreshRequest } from '../../runtime/messaging';
import { formatRelativeAge } from '../../ui/common/format';
import { DraftScene } from '../../ui/draft/DraftScene';
import { HistoryView, ProfilesView } from '../../ui/history/ExplorerViews';
import { HistoricalScene, getSelectedPlayerContext, type AppScene } from '../../ui/history/HistoricalScene';
import { TeamSection } from '../../ui/lobby/TeamSection';
import { PlayerDetailScene } from '../../ui/player/PlayerDetailScene';
import {
  APP_VERSION_LABEL,
  IS_PRIVATE_BUILD,
  formatDiagnosticsForClipboard,
  getDiagnostics,
  getLoadingDiscordIdsForDisplay,
  getLoadingProfileCount,
  isDraftSnapshot,
  isLobbyLockState,
  isPrematchRoster,
  isProfileLoading,
  isProfileSnapshot,
  normalizeLobbyLockForDisplay,
  normalizeProfileSnapshotForDisplay
} from '../../ui/scoutData';
import { UmaPlannerScene } from '../../ui/umas/UmaPlannerScene';

const STATS_SCOPE_STORAGE_KEY = 'statsScope';
const ACTIVE_CLOCK_REFRESH_MS = 1_000;
const IDLE_CLOCK_REFRESH_MS = 15_000;

export default function App() {
  const [mode, setMode] = useState<'live' | 'history' | 'profiles'>('live');
  const [historyScene, setHistoryScene] = useState<AppScene>('draft');
  const [historyNavigation, setHistoryNavigation] = useState(0);
  const [historyScope, setHistoryScope] = useState<PlayerStatsScope>('currentSeason');
  const [lookupScope, setLookupScope] = useState<PlayerStatsScope>('currentSeason');
  const [roster, setRoster] = useState<PrematchRoster | undefined>();
  const [draftSnapshot, setDraftSnapshot] = useState<DraftSnapshot | undefined>();
  const [storedProfileSnapshot, setProfileSnapshot] = useState<PlayerProfileSummariesSnapshot | undefined>();
  const [statsScope, setStatsScope] = useState<PlayerStatsScope>('currentSeason');
  const [activeScene, setActiveScene] = useState<AppScene>('lobby');
  const [selectedPlayerKey, setSelectedPlayerKey] = useState<string | undefined>();
  const [lobbyLock, setLobbyLock] = useState<LobbyLockState | undefined>();
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const isLobbyLocked = lobbyLock?.locked === true && lobbyLock.roster !== undefined;
  const displayedRoster = isLobbyLocked ? lobbyLock.roster : roster;
  const profileSnapshot = useMemo(() => {
    if (displayedRoster === undefined || storedProfileSnapshot?.matchCode !== displayedRoster.matchCode) return undefined;
    const ids = new Set(displayedRoster.players.map(player => player.discordId));
    return storedProfileSnapshot === undefined ? undefined : {
      ...storedProfileSnapshot,
      profiles: Object.fromEntries(Object.entries(storedProfileSnapshot.profiles).filter(([id]) => ids.has(id))),
      profileStates: Object.fromEntries(Object.entries(storedProfileSnapshot.profileStates ?? {}).filter(([id]) => ids.has(id))),
      loadingDiscordIds: storedProfileSnapshot.loadingDiscordIds.filter(id => ids.has(id))
    };
  }, [displayedRoster, storedProfileSnapshot]);
  const retryAt = Math.max(0, ...Object.values(profileSnapshot?.profileStates ?? {}).map(state => state.retryAt ?? 0));
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));

  useEffect(() => {
    let rosterChanged = false;
    let draftChanged = false;
    let profilesChanged = false;
    let lockChanged = false;
    void getLatestPrematchRoster().then((storedRoster) => {
      if (!rosterChanged) setRoster(normalizeRosterForDisplay(storedRoster));
    });
    void getLatestDraftSnapshot().then(snapshot => { if (!draftChanged) setDraftSnapshot(snapshot); });
    void getPlayerProfileSummaries().then((storedProfiles) => {
      if (!profilesChanged) setProfileSnapshot(normalizeProfileSnapshotForDisplay(storedProfiles));
    });
    void getLobbyLockState().then((storedLock) => {
      if (!lockChanged) setLobbyLock(normalizeLobbyLockForDisplay(storedLock));
    });
    void getStoredStatsScope().then(setStatsScope);
    void sendLobbyReconnectRequest().catch(error => console.debug('[UmaLytics] Reconnect failed:', error));

    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local') {
        return;
      }

      const rosterChange = changes[LATEST_PREMATCH_ROSTER_STORAGE_KEY];

      if (rosterChange !== undefined) {
        rosterChanged = true;
        setRoster(
          isPrematchRoster(rosterChange.newValue)
            ? normalizeRosterForDisplay(rosterChange.newValue)
            : undefined
        );
      }

      const draftChange = changes[LATEST_DRAFT_SNAPSHOT_STORAGE_KEY];

      if (draftChange !== undefined) {
        draftChanged = true;
        setDraftSnapshot(isDraftSnapshot(draftChange.newValue) ? draftChange.newValue : undefined);
      }

      const profileChange = changes[PLAYER_PROFILE_SUMMARIES_STORAGE_KEY];

      if (profileChange !== undefined) {
        profilesChanged = true;
        setProfileSnapshot(
          isProfileSnapshot(profileChange.newValue)
            ? normalizeProfileSnapshotForDisplay(profileChange.newValue)
            : undefined
        );
      }

      const lockChange = changes[LOBBY_LOCK_STORAGE_KEY];

      if (lockChange !== undefined) {
        lockChanged = true;
        setLobbyLock(
          isLobbyLockState(lockChange.newValue)
            ? normalizeLobbyLockForDisplay(lockChange.newValue)
            : undefined
        );
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      rosterChanged = draftChanged = profilesChanged = lockChanged = true;
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (displayedRoster === undefined) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setNow(Date.now());
    }, getClockRefreshDelayMs(profileSnapshot, now));

    return () => {
      window.clearTimeout(timer);
    };
  }, [displayedRoster, now, profileSnapshot]);

  const teamGroups = useMemo(() => getTeamGroups(displayedRoster), [displayedRoster]);
  const selectedPlayerContext = useMemo(
    () => getSelectedPlayerContext(teamGroups, selectedPlayerKey),
    [teamGroups, selectedPlayerKey]
  );
  const loadingProfiles = getLoadingProfileCount(profileSnapshot);
  const hasRoster = displayedRoster !== undefined;
  const lobbyPlayerCount = displayedRoster?.players.length ?? 0;
  const refreshCooldownMs = getRefreshCooldownMs(profileSnapshot?.manualRefreshAt, now);
  const canRefresh = hasRoster && loadingProfiles === 0 && refreshCooldownMs === 0;
  const profileStatusLabel = hasRoster
    ? getProfileSnapshotStatus(profileSnapshot, loadingProfiles, now, isLobbyLocked, statsScope)
    : undefined;
  const diagnostics = useMemo(
    () => getDiagnostics(
      displayedRoster,
      draftSnapshot,
      profileSnapshot,
      teamGroups,
      loadingProfiles,
      statsScope,
      now,
      isLobbyLocked,
      lobbyLock?.lockedAt
    ),
    [displayedRoster, draftSnapshot, isLobbyLocked, loadingProfiles, lobbyLock?.lockedAt, now, profileSnapshot, statsScope, teamGroups]
  );

  useEffect(() => {
    if (selectedPlayerKey !== undefined && selectedPlayerContext === undefined) {
      setSelectedPlayerKey(undefined);
    }
  }, [selectedPlayerContext, selectedPlayerKey]);

  const selectStatsScope = (nextStatsScope: PlayerStatsScope) => {
    setStatsScope(nextStatsScope);
    void browser.storage.local.set({ [STATS_SCOPE_STORAGE_KEY]: nextStatsScope });
  };

  const refreshProfiles = () => {
    if (displayedRoster === undefined || !canRefresh) {
      return;
    }

    if (isLobbyLocked) {
      void sendProfileRefreshRequest(displayedRoster);
      return;
    }

    void sendLobbyReconnectRequest().then((result) => {
      if (result?.activeLobby !== true || result.matchCode !== displayedRoster.matchCode) {
        return;
      }

      void sendProfileRefreshRequest(displayedRoster);
    });
  };

  const toggleLobbyLock = () => {
    if (isLobbyLocked) {
      setLobbyLock(undefined);
      void clearLobbyLockState();
      void sendLobbyReconnectRequest();
      return;
    }

    if (displayedRoster === undefined) {
      return;
    }

    const nextLockState: LobbyLockState = {
      locked: true,
      roster: displayedRoster,
      lockedAt: Date.now()
    };

    setLobbyLock(nextLockState);
    void setLobbyLockState(nextLockState);
  };

  const copyDiagnostics = () => {
    void browser.runtime.sendMessage({ type: 'diagnostic-trace-requested' }).then(trace => {
    const text = formatDiagnosticsForClipboard(diagnostics) + '\n\nRecent event trace (no tokens or chat):\n' + JSON.stringify(trace ?? [], null, 2);

    void navigator.clipboard.writeText(text).then(() => {
      setDiagnosticsCopied(true);
      window.setTimeout(() => {
        setDiagnosticsCopied(false);
      }, 1_500);
    }).catch((caught) => {
      console.warn('[UmaLytics] Unable to copy diagnostics:', caught);
    });
    }).catch(caught => console.warn('[UmaLytics] Unable to read diagnostics:', caught));
  };

  const visibleScene = mode === 'history' ? historyScene : activeScene;
  const visibleScope = mode === 'live' ? statsScope : mode === 'history' ? historyScope : lookupScope;
  const changeScope = mode === 'live' ? selectStatsScope : mode === 'history' ? setHistoryScope : setLookupScope;
  return (
    <main className="app-shell surface-scout">

      <header className="app-header">
        <div>
          <div className="app-title-row">
            <h1>UmaLytics</h1>
            <span className={IS_PRIVATE_BUILD ? 'app-version private' : 'app-version'}>
              v{APP_VERSION_LABEL}{IS_PRIVATE_BUILD ? ' (private)' : ''}
            </span>
            <button
              type="button"
              className={diagnosticsCopied ? 'diagnostics-copy active' : 'diagnostics-copy'}
              title="Copy scout diagnostics"
              aria-label="Copy scout diagnostics"
              onClick={copyDiagnostics}
            >
              <span className="clipboard-glyph" aria-hidden="true" />
              <span className="diagnostics-copy-label">{diagnosticsCopied ? 'Copied' : 'Copy diagnostics'}</span>
            </button>
          </div>
          <p className="app-credits">
            UmaLytics by{' '}
            <a href="https://github.com/kjunodev/umalytics" target="_blank" rel="noreferrer">
              k.juno
            </a>
            {' '} - Uma Drafter by{' '}
            <a href="https://drafter.uma.guide" target="_blank" rel="noreferrer">
              Terumi
            </a>
          </p>
          <div className="header-context">
            <p>{mode === 'live' ? (displayedRoster?.matchCode === undefined ? 'Lobby scouting' : `Match ${displayedRoster.matchCode}`) : mode === 'history' ? 'Completed match scouting' : 'Single player lookup'}</p>
            <p className="profile-freshness">{mode === 'live' ? (profileStatusLabel ?? 'Waiting for lobby data') : 'Player statistics reflect the selected time window'}</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="live-header-controls" style={{ visibility: mode === 'live' ? 'visible' : 'hidden' }} aria-hidden={mode !== 'live'} inert={mode !== 'live'}>
          <div className="header-control-row">
            {hasRoster ? (
              <button
                type="button"
                className={refreshCooldownMs > 0 ? 'refresh-button cooldown' : 'refresh-button'}
                disabled={!canRefresh}
                onClick={refreshProfiles}
              >
                {loadingProfiles > 0
                  ? 'Refreshing'
                  : refreshCooldownMs > 0
                    ? `Wait ${Math.ceil(refreshCooldownMs / 1000)}s`
                    : 'Refresh data'}
              </button>
            ) : null}
            {displayedRoster === undefined ? (
              <span className="status-pill idle">Waiting</span>
            ) : null}
          </div>
          {hasRoster ? (
            <div className="header-control-row">
              <button
                type="button"
                className={isLobbyLocked ? 'lock-button active' : 'lock-button'}
                onClick={toggleLobbyLock}
                title={
                  isLobbyLocked
                    ? 'Unlock live lobby player updates.'
                    : 'Freeze the current players while draft data keeps updating.'
                }
              >
                {isLobbyLocked ? `Locked ${lobbyPlayerCount}/10` : `Lock ${lobbyPlayerCount}/10`}
              </button>
            </div>
          ) : null}
          </div>
          <div className="stats-scope-toggle" aria-label="Stats time window">
            <button
              type="button"
              aria-pressed={visibleScope === 'currentSeason'} className={visibleScope === 'currentSeason' ? 'active' : ''}
              title="Show current season records, scoring, and Uma stats."
              onClick={() => {
                changeScope('currentSeason');
              }}
            >
              Season
            </button>
            <button
              type="button"
              aria-pressed={visibleScope === 'allTime'} className={visibleScope === 'allTime' ? 'active' : ''}
              title="Show all-time ranked records, scoring, and Uma stats. Rank still uses the active season leaderboard."
              onClick={() => {
                changeScope('allTime');
              }}
            >
              All-time
            </button>
          </div>
        </div>
        <nav className="app-navigation" aria-label="Scout navigation">
          <div className="scene-toggle mode-toggle" aria-label="UmaLytics mode">
            {(['live', 'history', 'profiles'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{value === 'live' ? 'Live' : value === 'history' ? 'History' : 'Profiles'}</button>)}
          </div>
          <div className="scene-toggle subscene-toggle" aria-label="UmaLytics scene" style={{ visibility: mode === 'profiles' ? 'hidden' : 'visible' }} aria-hidden={mode === 'profiles'} inert={mode === 'profiles'}>
            {(['lobby', 'draft', 'umas'] as const).map(scene => <button key={scene} type="button" aria-pressed={visibleScene === scene} className={visibleScene === scene ? 'active' : ''} onClick={() => { if (mode === 'history') { setHistoryScene(scene); setHistoryNavigation(value => value + 1); } else { setSelectedPlayerKey(undefined); setActiveScene(scene); } }}>{scene === 'lobby' ? 'Lobby' : scene === 'draft' ? 'Draft' : 'Umas'}</button>)}
          </div>
        </nav>
      </header>

      <div hidden={mode !== 'history'}><HistoryView Scene={HistoricalScene} scene={historyScene} scope={historyScope} navigation={historyNavigation} /></div>
      <div hidden={mode !== 'profiles'}><ProfilesView Detail={PlayerDetailScene} scope={lookupScope} /></div>
      <div hidden={mode !== 'live'}>
      {retryAt > 0 && (
        <p className="api-retry-notice" role="status">
          {retrySeconds > 0 ? `Stats API paused. Automatic retry in approximately ${retrySeconds}s.` : 'Waiting for the browser to resume profile requests.'}
          {' '}Available stats remain visible.
        </p>
      )}

      {displayedRoster === undefined ? (
        <section className="empty-state">
          <h2>No lobby detected</h2>
          <p>Open an Uma Drafter lobby or spectate page to populate player scouting.</p>
        </section>
      ) : selectedPlayerContext !== undefined ? (
        <PlayerDetailScene
          team={selectedPlayerContext.team}
          player={selectedPlayerContext.player}
          profile={profileSnapshot?.profiles[selectedPlayerContext.player.discordId]}
          isProfileLoading={isProfileLoading(profileSnapshot, selectedPlayerContext.player.discordId)}
          statsScope={statsScope}
          now={now}
          onBack={() => {
            setSelectedPlayerKey(undefined);
          }}
        />
      ) : activeScene === 'draft' ? (
        <DraftScene
          snapshot={draftSnapshot}
          roster={displayedRoster}
          profiles={profileSnapshot?.profiles ?? {}}
          statsScope={statsScope}
        />
      ) : activeScene === 'umas' ? (
        <UmaPlannerScene
          roster={displayedRoster}
          profiles={profileSnapshot?.profiles ?? {}}
          statsScope={statsScope}
        />
      ) : (
        <section className="team-list" aria-label="Detected lobby teams">
          {teamGroups.map((team) => (
            <TeamSection
              key={`${team.id}:${team.name ?? ""}`}
              team={team}
              profiles={profileSnapshot?.profiles ?? {}}
              loadingDiscordIds={getLoadingDiscordIdsForDisplay(profileSnapshot)}
              statsScope={statsScope}
              onSelectPlayer={setSelectedPlayerKey}
            />
          ))}
        </section>
      )}
      </div>
    </main>
  );
}

function getClockRefreshDelayMs(
  snapshot: PlayerProfileSummariesSnapshot | undefined,
  now: number
): number {
  if (snapshot === undefined) {
    return IDLE_CLOCK_REFRESH_MS;
  }

  if (getLoadingProfileCount(snapshot) > 0) {
    return ACTIVE_CLOCK_REFRESH_MS;
  }

  return getRefreshCooldownMs(snapshot.manualRefreshAt, now) > 0
    ? ACTIVE_CLOCK_REFRESH_MS
    : IDLE_CLOCK_REFRESH_MS;
}

function getProfileSnapshotStatus(
  snapshot: PlayerProfileSummariesSnapshot | undefined,
  loadingProfiles: number,
  now: number,
  isLobbyLocked = false,
  scope: PlayerStatsScope = 'currentSeason'
): string | undefined {
  if (loadingProfiles > 0) {
    return `Refreshing ${loadingProfiles} profile${loadingProfiles === 1 ? '' : 's'}`;
  }

  if (snapshot === undefined) {
    return undefined;
  }

  const checkedAt = latestStatsCheckAt(snapshot, scope);
  return checkedAt === undefined ? 'Stats not checked for this scope' :
    `${isLobbyLocked ? 'Locked lobby - l' : 'L'}atest stats check ${formatRelativeAge(checkedAt, now)}`;
}

async function getStoredStatsScope(): Promise<PlayerStatsScope> {
  const values = await browser.storage.local.get(STATS_SCOPE_STORAGE_KEY);
  const storedStatsScope = values[STATS_SCOPE_STORAGE_KEY];

  return storedStatsScope === 'allTime' || storedStatsScope === 'currentSeason'
    ? storedStatsScope
    : 'currentSeason';
}
