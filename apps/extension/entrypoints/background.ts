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
  fetchPlayerProfileSummaries
} from '../utils/playerProfileApi';
import {
  getPlayerProfileSummaries,
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
import { clearLatestDraftSnapshot, setLatestDraftSnapshot } from '../utils/draftStorage';
import {
  clearLatestPrematchRoster,
  getLatestPrematchRoster,
  setLatestPrematchRoster
} from '../utils/rosterStorage';
import { getLobbyLockState } from '../utils/lobbyLockStorage';
import { extractMatchCodeFromUrl } from '../utils/matchDetection';
import { isHashedUmaAssetUrl } from '../utils/umaPortraits';

const SCOUT_POPOUT_PATH = '/scout.html';
const CONTENT_SCRIPT_PATH = '/content-scripts/content.js' as ScriptPublicPath;
const DRAFTER_URL_PATTERN = 'https://drafter.uma.guide/*';
const SCOUT_POPOUT_WIDTH = 1320;
const SCOUT_POPOUT_HEIGHT = 1100;

let enrichmentRunId = 0;
let scoutWindowId: number | undefined;

export default defineBackground(() => {
  browser.action?.onClicked.addListener(() => {
    void openScoutWindow();
  });

  browser.windows?.onRemoved.addListener((windowId) => {
    if (windowId === scoutWindowId) {
      scoutWindowId = undefined;
    }
  });

  void reconnectOpenDrafterTabs();

  browser.runtime.onInstalled.addListener(() => {
    void reconnectOpenDrafterTabs();
  });

  browser.runtime.onStartup?.addListener(() => {
    void reconnectOpenDrafterTabs();
  });

  void getLatestPrematchRoster().then((roster) => {
    if (roster !== undefined && roster.players.length > 0) {
      void enrichRosterProfiles(roster);
    }
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isUmaLyticsMessage(message)) {
      return undefined;
    }

    if (message.type === 'prematch-roster-detected') {
      return handlePrematchRosterDetected(message.roster);
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

async function openScoutWindow(): Promise<void> {
  await handleLobbyReconnectRequested();

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

  await setLatestPrematchRoster(roster);
  await enrichRosterProfiles(roster);
}

async function handleLobbyReconnectRequested(): Promise<LobbyReconnectResult> {
  const activeTab = await getActiveDrafterTab();

  if (activeTab === undefined) {
    await clearActiveLobbyState();
    return { activeLobby: false };
  }

  await injectContentScriptIntoTab(activeTab.id);

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
    console.debug('[UmaLytics] Room DOM scan request skipped:', caught);
    return undefined;
  }
}

async function clearActiveLobbyState(): Promise<void> {
  enrichmentRunId += 1;
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
  const cachedSnapshot = await getPlayerProfileSummaries();
  const cooldownMs = getRefreshCooldownMs(cachedSnapshot?.updatedAt, Date.now());

  if (cooldownMs > 0) {
    return;
  }

  await enrichRosterProfiles(roster, { forceRefresh: true });
}

async function enrichRosterProfiles(
  roster: PrematchRoster,
  options: { forceRefresh?: boolean } = {}
): Promise<void> {
  const runId = ++enrichmentRunId;
  const now = Date.now();
  const cachedSnapshot = await getPlayerProfileSummaries();
  const cachedProfiles = cachedSnapshot?.profiles ?? {};
  const rosterDiscordIds = [...new Set(roster.players.map((player) => player.discordId))];
  const lookupDiscordIds = rosterDiscordIds.filter(isDiscordSnowflake);
  const freshProfiles = getFreshProfiles(cachedProfiles, rosterDiscordIds, now);
  const retainedProfiles = options.forceRefresh === true
    ? getRetainedProfiles(cachedProfiles, freshProfiles, rosterDiscordIds)
    : freshProfiles;
  const missingDiscordIds = lookupDiscordIds.filter(
    (discordId) => options.forceRefresh === true || freshProfiles[discordId] === undefined
  );
  const missingPlayers = roster.players.filter((player) => missingDiscordIds.includes(player.discordId));
  const profilesByDiscordId: Record<string, PlayerProfileSummary> = { ...retainedProfiles };
  const profileStates = buildProfileLoadStates(retainedProfiles, missingPlayers, now);

  await writeProfileSnapshot(roster.matchCode, profilesByDiscordId, profileStates);

  if (missingDiscordIds.length === 0) {
    return;
  }

  try {
    const fetchedProfiles = await fetchPlayerProfileSummaries(
      missingPlayers,
      {
        onStart: async (player) => {
          if (runId !== enrichmentRunId) {
            return;
          }

          const startedAt = Date.now();
          profileStates[player.discordId] = {
            discordId: player.discordId,
            status: 'loading',
            startedAt,
            updatedAt: startedAt
          };

          await writeProfileSnapshot(roster.matchCode, profilesByDiscordId, profileStates);
        },
        onSummary: async (summary) => {
          if (runId !== enrichmentRunId) {
            return;
          }

          profilesByDiscordId[summary.discordId] = summary;
          profileStates[summary.discordId] = buildCompletedProfileState(
            summary.discordId,
            summary,
            Date.now()
          );

          await writeProfileSnapshot(roster.matchCode, profilesByDiscordId, profileStates);
        }
      }
    );

    if (runId !== enrichmentRunId) {
      return;
    }

    for (const summary of Object.values(fetchedProfiles)) {
      profilesByDiscordId[summary.discordId] = summary;
      profileStates[summary.discordId] = buildCompletedProfileState(
        summary.discordId,
        summary,
        Date.now()
      );
    }

    await writeProfileSnapshot(roster.matchCode, profilesByDiscordId, profileStates);
  } catch (caught) {
    if (runId !== enrichmentRunId) {
      return;
    }

    console.warn('[UmaLytics] Profile scouting failed:', caught);
    const failedAt = Date.now();

    for (const player of missingPlayers) {
      if (!isPendingProfileState(profileStates[player.discordId])) {
        continue;
      }

      const summary = buildUnavailablePlayerSummary(player, getErrorMessage(caught));
      profilesByDiscordId[player.discordId] = summary;
      profileStates[player.discordId] = buildCompletedProfileState(player.discordId, summary, failedAt);
    }

    await writeProfileSnapshot(roster.matchCode, profilesByDiscordId, profileStates);
  }
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
  profileStates: Record<string, PlayerProfileLoadState>
): Promise<void> {
  await setPlayerProfileSummaries({
    matchCode,
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
        entry[1].error === undefined
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
          now - profile.fetchedAt < PROFILE_CACHE_TTL_MS &&
          hasCurrentStatsShape(profile) &&
          hasResolvedProfileStatLabels(profile) &&
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

function hasResolvedProfileStatLabels(profile: PlayerProfileSummary): boolean {
  return [
    profile.topUmas,
    profile.bestUmas,
    profile.allUmas,
    profile.currentSeasonStats?.topUmas,
    profile.currentSeasonStats?.bestUmas,
    profile.currentSeasonStats?.allUmas,
    profile.allTimeStats?.topUmas,
    profile.allTimeStats?.bestUmas,
    profile.allTimeStats?.allUmas
  ].every((umas) => hasResolvedUmaMetadata(umas));
}

function hasResolvedUmaMetadata(umas: PlayerProfileSummary['topUmas']): boolean {
  if (umas === undefined || umas.length === 0) {
    return true;
  }

  return umas.every((uma) => uma.name !== uma.umaId && !isHashedUmaAssetUrl(uma.imageUrl));
}

function getRefreshCooldownMs(updatedAt: number | undefined, now: number): number {
  if (updatedAt === undefined) {
    return 0;
  }

  return Math.max(updatedAt + MANUAL_PROFILE_REFRESH_COOLDOWN_MS - now, 0);
}
