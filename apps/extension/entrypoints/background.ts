import { recordDiagnostic, getDiagnosticTrace } from '../utils/diagnosticRecorder';
import { normalizeRosterForDisplay } from '../utils/rosterDisplay';
import { browser } from 'wxt/browser';
import type { ScriptPublicPath } from 'wxt/utils/inject-script';
import type { PlayerProfileSummary, PrematchPlayer, PrematchRoster } from '@umalytics/shared';
import {
  isUmaLyticsMessage,
  sendRoomDomScanRequest,
  type LobbyReconnectResult,
  type RoomDomScanResult
} from '../utils/messaging';
import {
  buildUnavailablePlayerSummary,
  fetchPlayerProfileSummaries,
  getApiCooldown,
  restoreApiCooldown,
  type ApiCooldown
} from '../utils/playerProfileApi';
import {
  getPlayerProfileSummaries,
  getCachedPlayerProfiles,
  rememberCachedPlayerProfiles,
  setPlayerProfileSummaries,
  type PlayerProfileLoadState,
  type PlayerProfileLoadStatus
} from '../utils/profileStorage';
import {
  BEST_UMA_SCORE_VERSION,
  MANUAL_PROFILE_REFRESH_COOLDOWN_MS,
  PROFILE_CACHE_TTL_MS,
  RECENT_HISTORY_VERSION
} from '../utils/profileConstants';
import { getLatestDraftSnapshot, clearLatestDraftSnapshot, setLatestDraftSnapshot } from '../utils/draftStorage';
import {
  clearLatestPrematchRoster,
  getLatestPrematchRoster,
  setLatestPrematchRoster
} from '../utils/rosterStorage';
import { getLobbyLockState } from '../utils/lobbyLockStorage';
import { extractMatchCodeFromUrl } from '../utils/matchDetection';

const SCOUT_POPOUT_PATH = '/scout.html';
const CONTENT_SCRIPT_PATH = '/content-scripts/content.js' as ScriptPublicPath;
const DRAFTER_URL_PATTERN = 'https://drafter.uma.guide/*';
const SCOUT_POPOUT_WIDTH = 1320;
const SCOUT_POPOUT_HEIGHT = 1100;

let enrichmentRunId = 0;
let scoutWindowId: number | undefined;
let openingWindow: Promise<void> | undefined;
let reconnecting: Promise<LobbyReconnectResult> | undefined;
let activeEnrichment: { key: string; controller: AbortController; promise: Promise<void>; finishedAt?: number } | undefined;
let profileWrites = Promise.resolve();
let rosterWrites = Promise.resolve();
let selectedDrafterTabId: number | undefined;
let navigationRunId = 0;
let lastManualRefreshAt = 0;
const RECOVERY_ALARM = 'umalytics-profile-recovery';
const RECOVERY_STORAGE_KEY = 'profileRecovery';
const MAX_AUTOMATIC_RETRIES = 2;
interface ProfileRecovery {
  key: string;
  attempt: number;
  retryAt: number;
  cooldown: ApiCooldown;
  exhausted?: boolean;
}
let selectedStatsScope: 'currentSeason' | 'allTime' = 'currentSeason';
interface EnrichmentOptions { forceRefresh?: boolean; recoveryAttempt?: number }
let pendingRecovery: ProfileRecovery | undefined;
let recoveryWrites = Promise.resolve();
let initialization = Promise.resolve();

export default defineBackground(() => {
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
    if (windowId === scoutWindowId) {
      scoutWindowId = undefined;
    }
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

function openScoutWindow(): Promise<void> {
  if (openingWindow !== undefined) return openingWindow;
  openingWindow = createOrFocusScoutWindow().finally(() => { openingWindow = undefined; });
  return openingWindow;
}

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

async function createOrFocusScoutWindow(): Promise<void> {
  // The UI can render cached data before any page scan or network request finishes.
  void handleLobbyReconnectRequested().catch(reportEnrichmentError);

  if (scoutWindowId !== undefined) {
    try {
      await browser.windows.update(scoutWindowId, {
        focused: true,
        width: SCOUT_POPOUT_WIDTH,
        height: SCOUT_POPOUT_HEIGHT
      });
      return;
    } catch {
      scoutWindowId = undefined;
    }
  }

  const scoutWindow = await browser.windows.create({
    url: browser.runtime.getURL(SCOUT_POPOUT_PATH),
    type: 'popup',
    width: SCOUT_POPOUT_WIDTH,
    height: SCOUT_POPOUT_HEIGHT,
    focused: true
  });

  scoutWindowId = scoutWindow?.id;
}

async function reconnectOpenDrafterTabs(): Promise<void> {
  const tabs = await browser.tabs.query({ url: DRAFTER_URL_PATTERN });
  await Promise.all(tabs.map((tab) => injectContentScriptIntoTab(tab.id)));
}

async function injectContentScriptIntoTab(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) {
    return;
  }

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_PATH]
    });
  } catch (caught) {
    console.debug('[UmaLytics] Content script reconnect skipped:', caught);
  }
}

async function getActiveDrafterTab(): Promise<Browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeCurrentWindowTab = tabs.find((tab) => tab.url?.startsWith('https://drafter.uma.guide/') === true);

  if (activeCurrentWindowTab !== undefined) {
    return activeCurrentWindowTab;
  }

  const drafterTabs = await browser.tabs.query({ url: DRAFTER_URL_PATTERN });

  return (
    drafterTabs.find((tab) => tab.active) ??
    drafterTabs.find((tab) => getTabMatchCode(tab) !== undefined) ??
    drafterTabs[0]
  );
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

async function requestRoomDomScan(
  tabId: number | undefined,
  options: { force?: boolean } = {}
): Promise<RoomDomScanResult | undefined> {
  if (tabId === undefined) {
    return undefined;
  }

  try {
    return await sendRoomDomScanRequest(tabId, options);
  } catch (caught) {
    await injectContentScriptIntoTab(tabId);
    try { return await sendRoomDomScanRequest(tabId, options); }
    catch (retryError) {
      console.debug('[UmaLytics] Room DOM scan request skipped:', retryError);
      return undefined;
    }
  }
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

function getTabMatchCode(tab: Browser.tabs.Tab | undefined): string | undefined {
  if (tab?.url === undefined) {
    return undefined;
  }

  try {
    return extractMatchCodeFromUrl(tab.url);
  } catch {
    return undefined;
  }
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

function markProfilesForRecovery(states: Record<string, PlayerProfileLoadState>, ids: string[], recovery: ProfileRecovery): void {
  for (const id of ids) {
    if (states[id] === undefined) continue;
    states[id] = { ...states[id], status: 'queued', retryAt: recovery.retryAt,
      stage: `API paused after HTTP ${recovery.cooldown.status}; automatic retry ${recovery.attempt}/${MAX_AUTOMATIC_RETRIES}`,
      error: states[id].error ?? `HTTP ${recovery.cooldown.status}: ${recovery.cooldown.path}`, updatedAt: Date.now() };
  }
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

function retainUsableProfile(previous: PlayerProfileSummary | undefined, next: PlayerProfileSummary): PlayerProfileSummary {
  // Keep useful cached data on transport failure, but never override a confirmed privacy response.
  if (next.error !== undefined && next.statsPrivate !== true && previous !== undefined &&
      hasUsableProfileStats(previous) && !hasUsableProfileStats(next)) {
    return { ...previous, error: next.error };
  }
  return mergeProfileScopes(previous, next);
}

function mergeProfileScopes(previous: PlayerProfileSummary | undefined, next: PlayerProfileSummary): PlayerProfileSummary {
  if (!previous || !next.scopeFetchedAt || next.statsPrivate) return next;
  return { ...next, scopeFetchedAt: { ...previous.scopeFetchedAt, ...next.scopeFetchedAt },
    currentSeasonStats: next.scopeFetchedAt.currentSeason ? next.currentSeasonStats : previous.currentSeasonStats ?? next.currentSeasonStats,
    allTimeStats: next.scopeFetchedAt.allTime ? next.allTimeStats : previous.allTimeStats ?? next.allTimeStats };
}

function buildProfileLoadStates(
  profiles: Record<string, PlayerProfileSummary>,
  loadingPlayers: PrematchPlayer[],
  now: number
): Record<string, PlayerProfileLoadState> {
  const profileStates = Object.fromEntries(
    Object.entries(profiles).map(([discordId, profile]) => [
      discordId,
      buildCompletedProfileState(discordId, profile, profile.fetchedAt)
    ] as const)
  );

  for (const player of loadingPlayers) {
    profileStates[player.discordId] = {
      discordId: player.discordId,
      status: 'queued',
      updatedAt: now
    };
  }

  return profileStates;
}

function buildCompletedProfileState(
  discordId: string,
  profile: PlayerProfileSummary,
  finishedAt: number
): PlayerProfileLoadState {
  return {
    discordId,
    status: getProfileLoadStatus(profile),
    startedAt: profile.fetchedAt,
    finishedAt,
    updatedAt: finishedAt,
    error: profile.error
  };
}

function getProfileLoadStatus(profile: PlayerProfileSummary): PlayerProfileLoadStatus {
  if (profile.error !== undefined) {
    return /timed out|taking longer/i.test(profile.error) ? 'timeout' : 'error';
  }

  if (profile.statsPrivate === true && !hasUsableProfileStats(profile)) {
    return 'private';
  }

  return 'loaded';
}

function hasUsableProfileStats(profile: PlayerProfileSummary): boolean {
  return (
    typeof profile.matches === 'number' ||
    (profile.topUmas?.length ?? 0) > 0 ||
    (profile.bestUmas?.length ?? 0) > 0 ||
    (profile.allUmas?.length ?? 0) > 0 ||
    (profile.recentMatches?.length ?? 0) > 0 ||
    (typeof profile.currentSeasonStats?.matches === 'number' && profile.currentSeasonStats.matches > 0) ||
    (typeof profile.allTimeStats?.matches === 'number' && profile.allTimeStats.matches > 0)
  );
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

function getLoadingDiscordIds(profileStates: Record<string, PlayerProfileLoadState>): string[] {
  return Object.values(profileStates)
    .filter(isPendingProfileState)
    .map((state) => state.discordId);
}

function getErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function isPendingProfileState(state: PlayerProfileLoadState | undefined): boolean {
  return state?.status === 'loading' || state?.status === 'queued';
}

function getRetainedProfiles(
  cachedProfiles: Record<string, PlayerProfileSummary>,
  freshProfiles: Record<string, PlayerProfileSummary>,
  discordIds: string[]
): Record<string, PlayerProfileSummary> {
  return Object.fromEntries(
    discordIds
      .map((discordId) => [discordId, cachedProfiles[discordId] ?? freshProfiles[discordId]] as const)
      .filter((entry): entry is readonly [string, PlayerProfileSummary] => (
        entry[1] !== undefined &&
        (entry[1].error === undefined || hasUsableProfileStats(entry[1]))
      ))
  );
}

function isDiscordSnowflake(value: string): boolean {
  return /^\d{16,20}$/.test(value);
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
          profile.bestUmaScoreVersion === BEST_UMA_SCORE_VERSION &&
          profile.recentHistoryVersion === RECENT_HISTORY_VERSION &&
          profile.currentSeasonStats?.recentHistoryVersion === RECENT_HISTORY_VERSION &&
          profile.allTimeStats?.recentHistoryVersion === RECENT_HISTORY_VERSION
        );
      })
  );
}

function hasCurrentStatsShape(profile: PlayerProfileSummary): boolean {
  return (
    profile.currentSeasonStats !== undefined &&
    profile.allTimeStats !== undefined &&
    Array.isArray(profile.allTimeStats.allUmas)
  );
}
