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
import { HistoryView } from '../../ui/history/ExplorerViews';
import { HistoricalScene, getSelectedPlayerContext, type AppScene } from '../../ui/history/HistoricalScene';
import { TeamSection } from '../../ui/lobby/TeamSection';
import { PlayerDrawer } from '../../ui/player/PlayerDrawer';
import { PlayersView } from '../../ui/players/PlayersView';
import {
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
import { AppHeader, type AppMode } from '../../ui/shell/AppHeader';
import { UmaPlannerScene } from '../../ui/umas/UmaPlannerScene';

const STATS_SCOPE_STORAGE_KEY = 'statsScope';
const ACTIVE_CLOCK_REFRESH_MS = 1_000;
const IDLE_CLOCK_REFRESH_MS = 15_000;

export default function App() {
  const [mode, setMode] = useState<'live' | 'history' | 'profiles'>('live');
  const [historyScene, setHistoryScene] = useState<AppScene>('draft');
  const [historyNavigation, setHistoryNavigation] = useState(0);
  const [historyScope, setHistoryScope] = useState<PlayerStatsScope>('currentSeason');
  const [historicalMatchCode, setHistoricalMatchCode] = useState<string>();
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

      <AppHeader
        mode={mode}
        onModeChange={setMode}
        visibleScene={visibleScene}
        onSceneChange={(scene) => {
          if (mode === 'history') {
            setHistoryScene(scene);
            setHistoryNavigation(value => value + 1);
          } else {
            setSelectedPlayerKey(undefined);
            setActiveScene(scene);
          }
        }}
        sceneDimmed={mode === 'profiles'}
        visibleScope={visibleScope}
        onScopeChange={changeScope}
        matchCode={displayedRoster?.matchCode}
        historicalMatchCode={historicalMatchCode}
        hasRoster={hasRoster}
        isLive={mode === 'live'}
        profileStatusLabel={profileStatusLabel}
        isLobbyLocked={isLobbyLocked}
        lobbyPlayerCount={lobbyPlayerCount}
        onToggleLobbyLock={toggleLobbyLock}
        canRefresh={canRefresh}
        isRefreshing={loadingProfiles > 0}
        refreshCooldownSeconds={Math.ceil(refreshCooldownMs / 1000)}
        onRefresh={refreshProfiles}
        diagnosticsCopied={diagnosticsCopied}
        onCopyDiagnostics={copyDiagnostics}
      />

      <div className="app-scene-area" hidden={mode !== 'history'}><HistoryView Scene={HistoricalScene} scene={historyScene} scope={historyScope} navigation={historyNavigation} onMatchCodeChange={setHistoricalMatchCode} /></div>
      <div className="app-scene-area" hidden={mode !== 'profiles'}><PlayersView roster={displayedRoster} statsScope={lookupScope} active={mode === 'profiles'} /></div>
      <div className="app-scene-area" hidden={mode !== 'live'}>
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
        <>
          <section className="team-list" aria-label="Detected lobby teams">
            {teamGroups.map((team) => (
              <TeamSection
                key={`${team.id}:${team.name ?? ""}`}
                team={team}
                profiles={profileSnapshot?.profiles ?? {}}
                loadingDiscordIds={getLoadingDiscordIdsForDisplay(profileSnapshot)}
                statsScope={statsScope}
                selectedPlayerKey={selectedPlayerKey}
                onSelectPlayer={setSelectedPlayerKey}
                onRetryProfile={refreshProfiles}
                canRetryProfile={canRefresh}
              />
            ))}
          </section>
          {selectedPlayerContext === undefined ? null : (
            <PlayerDrawer
              player={selectedPlayerContext.player}
              profile={profileSnapshot?.profiles[selectedPlayerContext.player.discordId]}
              onClose={() => {
                setSelectedPlayerKey(undefined);
              }}
              context={{
                team: selectedPlayerContext.team,
                statsScope,
                isProfileLoading: isProfileLoading(profileSnapshot, selectedPlayerContext.player.discordId),
                now,
                inLobby: true
              }}
            />
          )}
        </>
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
