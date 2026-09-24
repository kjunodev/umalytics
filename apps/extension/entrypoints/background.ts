import { recordDiagnostic, getDiagnosticTrace } from '../runtime/diagnosticRecorder';
import { hasCurrentHistoryState, mergeProfileScopes } from '../profiles/profileMerge';
import { registerExplorerService } from '../explorer/explorerService';
import { normalizeRosterForDisplay } from '../room/rosterDisplay';
import { browser } from 'wxt/browser';
import type { PlayerProfileSummary, PrematchRoster } from '@umalytics/shared';
import {
  isUmaLyticsMessage,
  type LobbyReconnectResult
} from '../runtime/messaging';
import {
  buildUnavailablePlayerSummary,
  fetchPlayerProfileSummaries,
  getApiCooldown,
  restoreApiCooldown
} from '../profiles/playerProfileApi';
import {
  getPlayerProfileSummaries,
  getCachedPlayerProfiles,
  rememberCachedPlayerProfiles,
  setPlayerProfileSummaries,
  type PlayerProfileLoadState
} from '../storage/profileStorage';
import {
  BEST_UMA_SCORE_VERSION,
  MANUAL_PROFILE_REFRESH_COOLDOWN_MS,
  PROFILE_CACHE_TTL_MS,
  RECENT_HISTORY_VERSION
} from '../profiles/profileConstants';
import { getLatestDraftSnapshot, clearLatestDraftSnapshot, setLatestDraftSnapshot } from '../storage/draftStorage';
import {
  clearLatestPrematchRoster,
  getLatestPrematchRoster,
  setLatestPrematchRoster
} from '../storage/rosterStorage';
import { getLobbyLockState } from '../storage/lobbyLockStorage';
import {
  MAX_AUTOMATIC_RETRIES,
  buildProfileLoadStates,
  buildCompletedProfileState,
  getErrorMessage,
  getLoadingDiscordIds,
  getRetainedProfiles,
  hasCurrentStatsShape,
  hasUsableProfileStats,
  isDiscordSnowflake,
  isPendingProfileState,
  markProfilesForRecovery,
  retainUsableProfile,
  type ProfileRecovery
} from '../background/profileStates';
import {
  configureScoutWindow,
  handleScoutWindowRemoved,
  openScoutWindow
} from '../background/scoutWindow';
import {
  getActiveDrafterTab,
  getTabMatchCode,
  reconnectOpenDrafterTabs,
  requestRoomDomScan
} from '../background/drafterTabs';

let enrichmentRunId = 0;
let reconnecting: Promise<LobbyReconnectResult> | undefined;
let activeEnrichment: { key: string; controller: AbortController; promise: Promise<void>; finishedAt?: number } | undefined;
let profileWrites = Promise.resolve();
let rosterWrites = Promise.resolve();
let selectedDrafterTabId: number | undefined;
let navigationRunId = 0;
let lastManualRefreshAt = 0;
const RECOVERY_ALARM = 'umalytics-profile-recovery';
const RECOVERY_STORAGE_KEY = 'profileRecovery';
let selectedStatsScope: 'currentSeason' | 'allTime' = 'currentSeason';
interface EnrichmentOptions { forceRefresh?: boolean; recoveryAttempt?: number }
let pendingRecovery: ProfileRecovery | undefined;
let recoveryWrites = Promise.resolve();
let initialization = Promise.resolve();

configureScoutWindow({ handleLobbyReconnectRequested, reportEnrichmentError });

export default defineBackground(() => {
  registerExplorerService(() => initialization);
  initialization = Promise.all([restoreManualRefresh(), restoreProfileRecovery(), browser.storage.local.get('statsScope').then(values => {
    selectedStatsScope = values.statsScope === 'allTime' ? 'allTime' : 'currentSeason';
  })]).then(() => {});
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.statsScope) return;
    selectedStatsScope = changes.statsScope.newValue === 'allTime' ? 'allTime' : 'currentSeason';
    void initialization.then(async () => {
      const lock = await getLobbyLockState();
      const roster = lock?.locked ? lock.roster : await getLatestPrematchRoster();
      if (roster) await enrichRosterProfiles(roster);
    }).catch(reportEnrichmentError);
  });
  browser.tabs.onActivated.addListener(({ tabId }) => {
    void handleActiveDrafterTab(tabId).catch(reportEnrichmentError);
  });
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (tab.active && change.url !== undefined) void handleActiveDrafterTab(tabId).catch(reportEnrichmentError);
  });
  browser.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === RECOVERY_ALARM) void initialization.then(resumeProfileRecovery).catch(reportEnrichmentError);
  });
  browser.action?.onClicked.addListener(() => {
    void openScoutWindow().catch((error) => console.warn('[UmaLytics] Cannot open scout:', error));
  });

  browser.windows?.onRemoved.addListener((windowId) => {
    handleScoutWindowRemoved(windowId);
  });

  void initialization.then(handleLobbyReconnectRequested).catch(reportEnrichmentError);

  browser.runtime.onInstalled.addListener(() => {
    void reconnectOpenDrafterTabs();
  });

  browser.runtime.onStartup?.addListener(() => {
    void reconnectOpenDrafterTabs();
  });

  browser.runtime.onMessage.addListener(async (message: unknown, sender) => {
    await initialization;
    if (!isUmaLyticsMessage(message)) {
      return undefined;
    }

    if (message.type === 'diagnostic-trace-requested') return getDiagnosticTrace();
    if (message.type === 'diagnostic-event') {
      if (sender.tab?.id === selectedDrafterTabId) recordDiagnostic(message.event);
      return;
    }
    if ((message.type === 'prematch-roster-detected' || message.type === 'draft-snapshot-detected') &&
        selectedDrafterTabId !== undefined && sender.tab?.id !== selectedDrafterTabId) return undefined;

    if (message.type === 'prematch-roster-detected') {
      const update = rosterWrites.then(() => {
        if (selectedDrafterTabId !== undefined && sender.tab?.id !== selectedDrafterTabId) return;
        return handlePrematchRosterDetected(message.roster);
      });
      rosterWrites = update.catch(reportEnrichmentError);
      return update;
    }

    if (message.type === 'draft-snapshot-detected') {
      return setLatestDraftSnapshot(message.snapshot);
    }

    if (message.type === 'profile-refresh-requested') {
      return handleProfileRefreshRequested(message.roster);
    }

    if (message.type === 'lobby-reconnect-requested') {
      return handleLobbyReconnectRequested();
    }

    return undefined;
  });
});

async function handleActiveDrafterTab(tabId: number): Promise<void> {
  const navigationId = ++navigationRunId;
  const tab = await browser.tabs.get(tabId);
  if (!tab.active || !tab.url?.startsWith('https://drafter.uma.guide/')) return;
  await initialization;
  const lock = await getLobbyLockState();
  if (lock?.locked || navigationId !== navigationRunId) return;
  const select = rosterWrites.then(async () => {
    if (navigationId !== navigationRunId) return;
    const previous = await getLatestPrematchRoster();
    if (navigationId !== navigationRunId) return;
    const matchCode = getTabMatchCode(tab);
    if (previous !== undefined && matchCode !== undefined && previous.matchCode !== matchCode) await clearActiveLobbyState();
    if (navigationId === navigationRunId) selectedDrafterTabId = tabId;
  });
  rosterWrites = select.catch(reportEnrichmentError);
  await select;
  // The scan publishes a roster back to the background; never hold rosterWrites
  // while awaiting that acknowledgement.
  if (navigationId === navigationRunId) await requestRoomDomScan(tabId, { force: true });
}

async function handlePrematchRosterDetected(roster: PrematchRoster): Promise<void> {
  const lockState = await getLobbyLockState();

  if (lockState?.locked === true && lockState.roster !== undefined) {
    return;
  }

  roster = normalizeRosterForDisplay(roster)!;
  const previousRoster = await getLatestPrematchRoster();
  if (previousRoster?.matchCode !== roster.matchCode) {
    const draft = await getLatestDraftSnapshot();
    if (draft?.matchCode !== roster.matchCode) await clearLatestDraftSnapshot();
  }
  await setLatestPrematchRoster(roster);
  void enrichRosterProfiles(roster).catch(reportEnrichmentError);
}

function handleLobbyReconnectRequested(): Promise<LobbyReconnectResult> {
  if (reconnecting !== undefined) return reconnecting;
  reconnecting = reconnectLobby().finally(() => { reconnecting = undefined; });
  return reconnecting;
}

async function reconnectLobby(): Promise<LobbyReconnectResult> {
  const activeTab = await getActiveDrafterTab();

  if (activeTab === undefined) {
    await clearActiveLobbyState();
    return { activeLobby: false };
  }

  selectedDrafterTabId = activeTab.id;

  const domScanResult = await requestRoomDomScan(activeTab.id, { force: true });
  const activeMatchCode = domScanResult?.matchCode ?? getTabMatchCode(activeTab);

  if (domScanResult?.activeLobby === true && activeMatchCode === undefined) {
    return { activeLobby: true };
  }

  if (activeMatchCode === undefined) {
    if (domScanResult?.activeLobby === false) {
      await clearActiveLobbyState();
    }

    return { activeLobby: false };
  }

  const cachedRoster = await getLatestPrematchRoster();

  if (cachedRoster !== undefined && cachedRoster.matchCode !== activeMatchCode) {
    await clearActiveLobbyState();
    selectedDrafterTabId = activeTab.id;
  }

  return { activeLobby: true, matchCode: activeMatchCode };
}

async function clearActiveLobbyState(): Promise<void> {
  enrichmentRunId += 1;
  activeEnrichment?.controller.abort(new Error('Lobby changed.'));
  activeEnrichment = undefined;
  selectedDrafterTabId = undefined;
  pendingRecovery = undefined;
  await persistProfileRecovery();
  await Promise.all([
    clearLatestPrematchRoster(),
    clearLatestDraftSnapshot()
  ]);
}

async function handleProfileRefreshRequested(roster: PrematchRoster): Promise<void> {
  if (Date.now() - lastManualRefreshAt < MANUAL_PROFILE_REFRESH_COOLDOWN_MS) {
    return;
  }
  lastManualRefreshAt = Date.now();
  await browser.storage.local.set({ profileManualRefreshAt: lastManualRefreshAt });
  void enrichRosterProfiles(roster, { forceRefresh: true }).catch(reportEnrichmentError);
}

async function restoreManualRefresh(): Promise<void> {
  const value = (await browser.storage.local.get('profileManualRefreshAt')).profileManualRefreshAt;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Date.now()) lastManualRefreshAt = value;
}

function reportEnrichmentError(error: unknown): void {
  console.warn('[UmaLytics] Background update failed:', error);
}

function enrichRosterProfiles(
  roster: PrematchRoster,
  options: EnrichmentOptions = {}
): Promise<void> {
  roster = normalizeRosterForDisplay(roster)!;
  // Membership controls fetching; team/name/phase changes only update the roster.
  const key = getEnrichmentKey(roster);
  if (activeEnrichment?.key === key && (activeEnrichment.finishedAt === undefined ||
      (options.forceRefresh !== true && options.recoveryAttempt === undefined && Date.now() - activeEnrichment.finishedAt < 10_000))) {
    return activeEnrichment.promise;
  }
  activeEnrichment?.controller.abort(new Error('Superseded roster.'));
  const controller = new AbortController();
  const runId = ++enrichmentRunId;
  const run = { key, controller, promise: Promise.resolve(), finishedAt: undefined as number | undefined };
  activeEnrichment = run;
  run.promise = performRosterEnrichment(roster, options, runId, controller.signal).finally(() => {
    run.finishedAt = Date.now();
  });
  return run.promise;
}

async function performRosterEnrichment(
  roster: PrematchRoster,
  options: EnrichmentOptions,
  runId: number,
  signal: AbortSignal
): Promise<void> {
  const scope = selectedStatsScope;
  const key = getEnrichmentKey(roster);
  if (pendingRecovery !== undefined && pendingRecovery.key !== key) {
    pendingRecovery = undefined;
    await persistProfileRecovery();
  }
  if (signal.aborted || runId !== enrichmentRunId) return;
  const recoveryExhausted = pendingRecovery?.exhausted && options.forceRefresh !== true;
  const recoveryAttempt = options.recoveryAttempt ??
    (pendingRecovery?.exhausted ? 0 : pendingRecovery?.attempt ?? 0);
  const now = Date.now();
  const [cachedSnapshot, cachedArchive] = await Promise.all([getPlayerProfileSummaries(), getCachedPlayerProfiles()]);
  if (signal.aborted || runId !== enrichmentRunId) return;
  const cachedProfiles = { ...cachedArchive, ...cachedSnapshot?.profiles };
  const rosterDiscordIds = [...new Set(roster.players.map((player) => player.discordId))];
  const lookupDiscordIds = rosterDiscordIds.filter(isDiscordSnowflake);
  const freshProfiles = getFreshProfiles(cachedProfiles, rosterDiscordIds, now);
  const retainedProfiles = getRetainedProfiles(cachedProfiles, freshProfiles, rosterDiscordIds);
  const missingDiscordIds = lookupDiscordIds.filter(
    (discordId) => options.forceRefresh === true || freshProfiles[discordId] === undefined
  );
  // A phase/name/team update with fresh, unchanged profiles needs no profile
  // publication. Keep the roster update independent of profile storage and UI clocks.
  if (missingDiscordIds.length === 0 && pendingRecovery === undefined &&
      cachedSnapshot !== undefined && cachedSnapshot.matchCode === roster.matchCode &&
      cachedSnapshot.loadingDiscordIds?.length === 0 &&
      Object.keys(cachedSnapshot.profiles).length === rosterDiscordIds.length &&
      rosterDiscordIds.every(id => freshProfiles[id] !== undefined && cachedSnapshot.profiles[id] === retainedProfiles[id])) return;

  const missingPlayers = roster.players.filter((player) => missingDiscordIds.includes(player.discordId));
  const profilesByDiscordId: Record<string, PlayerProfileSummary> = { ...retainedProfiles };
  const profileStates = buildProfileLoadStates(retainedProfiles, missingPlayers, now);
  const publish = () => {
    // Serialize writes and check generation at commit time, including the initial queued snapshot.
    const write = profileWrites.then(async () => {
      if (signal.aborted || runId !== enrichmentRunId) return;
      await writeProfileSnapshot(roster.matchCode, profilesByDiscordId, profileStates, runId, now);
    });
    profileWrites = write.catch(reportEnrichmentError);
    return write;
  };

  if (recoveryExhausted) {
    // A worker may have stopped after persisting the exhausted budget but before
    // publishing terminal cards. Never leave those old queued states stuck.
    for (const player of missingPlayers) {
      profileStates[player.discordId] = {
        discordId: player.discordId, status: 'error', updatedAt: now,
        error: `Automatic retries exhausted after HTTP ${pendingRecovery?.cooldown.status} at ${pendingRecovery?.cooldown.path}. Use Refresh to try again.`
      };
    }
  }
  await publish();
  // Migrate the previous room before its UI snapshot is replaced, even when all
  // of its profiles were already fresh and needed no requests in this run.
  await rememberCachedPlayerProfiles(cachedSnapshot?.profiles ?? {});

  if (missingDiscordIds.length === 0) {
    pendingRecovery = undefined;
    await persistProfileRecovery();
    return;
  }
  if (recoveryExhausted) return;

  if (pendingRecovery?.key === key && !pendingRecovery.exhausted && pendingRecovery.retryAt > Date.now()) {
    markProfilesForRecovery(profileStates, missingDiscordIds, pendingRecovery);
    await persistProfileRecovery();
    await publish();
    return;
  }

  try {
    const fetchedProfiles = await fetchPlayerProfileSummaries(
      missingPlayers,
      {
        scope,
        signal,
        onProgress: async (summary) => {
          if (signal.aborted || runId !== enrichmentRunId) return;
          const previous = profilesByDiscordId[summary.discordId];
          if (previous === undefined || !hasUsableProfileStats(previous) || summary.statsPrivate === true) {
            profilesByDiscordId[summary.discordId] = mergeProfileScopes(previous, summary);
          }
          await publish();
        },
        onStage: async (player, stage) => {
          if (signal.aborted || runId !== enrichmentRunId) return;
          const state = profileStates[player.discordId];
          if (state !== undefined) { state.stage = stage; state.updatedAt = Date.now(); }
          await publish();
        },
        onStart: async (player) => {
          if (signal.aborted || runId !== enrichmentRunId) {
            return;
          }

          const startedAt = Date.now();
          profileStates[player.discordId] = {
            discordId: player.discordId,
            status: 'loading',
            startedAt,
            updatedAt: startedAt
          };

          await publish();
        },
        onSummary: async (summary) => {
          if (signal.aborted || runId !== enrichmentRunId) {
            return;
          }

          profilesByDiscordId[summary.discordId] = retainUsableProfile(profilesByDiscordId[summary.discordId], summary);
          profileStates[summary.discordId] = buildCompletedProfileState(
            summary.discordId,
            summary,
            Date.now()
          );

          await publish();
          await rememberCachedPlayerProfiles({ [summary.discordId]: profilesByDiscordId[summary.discordId]! });
        }
      }
    );

    if (signal.aborted || runId !== enrichmentRunId) {
      return;
    }

    for (const summary of Object.values(fetchedProfiles)) {
      profilesByDiscordId[summary.discordId] = retainUsableProfile(profilesByDiscordId[summary.discordId], summary);
      profileStates[summary.discordId] = buildCompletedProfileState(
        summary.discordId,
        summary,
        Date.now()
      );
    }

    await publish();
    await rememberCachedPlayerProfiles(profilesByDiscordId);
  } catch (caught) {
    if (signal.aborted || runId !== enrichmentRunId) {
      return;
    }

    console.warn('[UmaLytics] Profile scouting failed:', caught);
    const failedAt = Date.now();

    for (const player of missingPlayers) {
      if (!isPendingProfileState(profileStates[player.discordId])) {
        continue;
      }

      const summary = buildUnavailablePlayerSummary(player, getErrorMessage(caught));
      profilesByDiscordId[player.discordId] = retainUsableProfile(profilesByDiscordId[player.discordId], summary);
      profileStates[player.discordId] = buildCompletedProfileState(player.discordId, summary, failedAt);
    }

    await publish();
  }
  if (signal.aborted || runId !== enrichmentRunId) return;
  const failedIds = Object.values(profileStates).filter(state =>
    state.error !== undefined && /API paused|HTTP (429|5\d\d)/.test(state.error)).map(state => state.discordId);
  const cooldown = getApiCooldown();
  if (failedIds.length > 0 && cooldown !== undefined) {
    pendingRecovery = {
      key, cooldown, attempt: recoveryAttempt + 1,
      retryAt: Math.max(Date.now() + 1000, cooldown.until),
      exhausted: recoveryAttempt >= MAX_AUTOMATIC_RETRIES
    };
    if (!pendingRecovery.exhausted) markProfilesForRecovery(profileStates, failedIds, pendingRecovery);
    else for (const id of failedIds) {
      const state = profileStates[id];
      if (state !== undefined) state.error += '; Automatic retries exhausted. Use Refresh to try again.';
    }
  } else pendingRecovery = undefined;
  await persistProfileRecovery();
  await publish();
}

function getEnrichmentKey(roster: PrematchRoster): string {
  return JSON.stringify([selectedStatsScope, roster.matchCode, [...new Set(roster.players.map(player => player.discordId))].sort()]);
}

function persistProfileRecovery(): Promise<void> {
  const value = pendingRecovery;
  const write = recoveryWrites.then(async () => {
    if (value === undefined) await browser.storage.local.remove(RECOVERY_STORAGE_KEY);
    else await browser.storage.local.set({ [RECOVERY_STORAGE_KEY]: value });
    await browser.alarms.clear(RECOVERY_ALARM);
    if (value !== undefined && !value.exhausted) await browser.alarms.create(RECOVERY_ALARM, { when: Math.max(Date.now() + 1000, value.retryAt) });
  });
  recoveryWrites = write.catch(reportEnrichmentError);
  return write;
}

async function restoreProfileRecovery(): Promise<void> {
  const stored = (await browser.storage.local.get(RECOVERY_STORAGE_KEY))[RECOVERY_STORAGE_KEY] as ProfileRecovery | undefined;
  if (stored === undefined || typeof stored.key !== 'string' || !Number.isFinite(stored.retryAt) ||
      !Number.isFinite(stored.cooldown?.until) || !Number.isInteger(stored.attempt) || stored.attempt < 1) return;
  pendingRecovery = stored;
  restoreApiCooldown(stored.cooldown);
  await persistProfileRecovery();
}

async function resumeProfileRecovery(): Promise<void> {
  const recovery = pendingRecovery;
  if (recovery === undefined || recovery.exhausted) return;
  if (Date.now() < recovery.retryAt) { await persistProfileRecovery(); return; }
  const lock = await getLobbyLockState();
  const roster = normalizeRosterForDisplay(lock?.locked ? lock.roster : await getLatestPrematchRoster());
  if (pendingRecovery !== recovery) return;
  if (roster === undefined || getEnrichmentKey(roster) !== recovery.key) {
    pendingRecovery = undefined;
    await persistProfileRecovery();
    return;
  }
  await enrichRosterProfiles(roster, { recoveryAttempt: recovery.attempt, forceRefresh: false });
}

async function writeProfileSnapshot(
  matchCode: string | undefined,
  profiles: Record<string, PlayerProfileSummary>,
  profileStates: Record<string, PlayerProfileLoadState>,
  runId: number,
  startedAt: number
): Promise<void> {
  await setPlayerProfileSummaries({
    matchCode,
    runId,
    startedAt,
    manualRefreshAt: lastManualRefreshAt || undefined,
    profiles,
    profileStates,
    loadingDiscordIds: getLoadingDiscordIds(profileStates),
    updatedAt: Date.now()
  });
}

function getFreshProfiles(
  cachedProfiles: Record<string, PlayerProfileSummary>,
  discordIds: string[],
  now: number
): Record<string, PlayerProfileSummary> {
  return Object.fromEntries(
    discordIds
      .map((discordId) => [discordId, cachedProfiles[discordId]] as const)
      .filter((entry): entry is readonly [string, PlayerProfileSummary] => {
        const profile = entry[1];

        return (
          profile !== undefined &&
          profile.error === undefined &&
          profile.isPartial !== true &&
          now - (profile.scopeFetchedAt === undefined ? profile.fetchedAt : profile.scopeFetchedAt[selectedStatsScope] ?? 0) < PROFILE_CACHE_TTL_MS &&
          hasCurrentStatsShape(profile) &&
          hasCurrentHistoryState(profile, selectedStatsScope) &&
          profile.bestUmaScoreVersion === BEST_UMA_SCORE_VERSION &&
          profile.recentHistoryVersion === RECENT_HISTORY_VERSION &&
          profile.currentSeasonStats?.recentHistoryVersion === RECENT_HISTORY_VERSION &&
          profile.allTimeStats?.recentHistoryVersion === RECENT_HISTORY_VERSION
        );
      })
  );
}
