import { browser } from 'wxt/browser';
import type { ScriptPublicPath } from 'wxt/utils/inject-script';
import type { PlayerProfileSummary, PrematchRoster } from '@umalytics/shared';
import { isUmaLyticsMessage, type LobbyReconnectResult } from '../utils/messaging';
import { fetchPlayerProfileSummaries } from '../utils/playerProfileApi';
import {
  getPlayerProfileSummaries,
  setPlayerProfileSummaries
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

  if (activeCurrentWindowTab !== undefined && getTabMatchCode(activeCurrentWindowTab) !== undefined) {
    return activeCurrentWindowTab;
  }

  const drafterTabs = await browser.tabs.query({ url: DRAFTER_URL_PATTERN });

  return (
    drafterTabs.find((tab) => tab.active && getTabMatchCode(tab) !== undefined) ??
    drafterTabs.find((tab) => getTabMatchCode(tab) !== undefined) ??
    activeCurrentWindowTab ??
    drafterTabs.find((tab) => tab.active) ??
    drafterTabs[0]
  );
}

async function handlePrematchRosterDetected(roster: PrematchRoster): Promise<void> {
  console.log(`[UmaLytics] Roster detected: ${roster.players.length} players`);
  await setLatestPrematchRoster(roster);
  await enrichRosterProfiles(roster);
}

async function handleLobbyReconnectRequested(): Promise<LobbyReconnectResult> {
  const activeTab = await getActiveDrafterTab();
  const activeMatchCode = getTabMatchCode(activeTab);
  const cachedRoster = await getLatestPrematchRoster();

  if (activeTab === undefined || activeMatchCode === undefined) {
    await clearActiveLobbyState();
    return { activeLobby: false };
  }

  if (cachedRoster !== undefined && cachedRoster.matchCode !== activeMatchCode) {
    await clearActiveLobbyState();
  }

  await injectContentScriptIntoTab(activeTab.id);
  return { activeLobby: true, matchCode: activeMatchCode };
}

async function clearActiveLobbyState(): Promise<void> {
  enrichmentRunId += 1;
  console.log('[UmaLytics] Active lobby reset');
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
    console.log('[UmaLytics] Profile refresh skipped during cooldown:', Math.ceil(cooldownMs / 1000));
    return;
  }

  console.log('[UmaLytics] Profile refresh requested:', roster.matchCode);
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

  await setPlayerProfileSummaries({
    matchCode: roster.matchCode,
    profiles: retainedProfiles,
    loadingDiscordIds: missingDiscordIds,
    updatedAt: now
  });

  if (missingDiscordIds.length === 0) {
    return;
  }

  try {
    const fetchedProfiles = await fetchPlayerProfileSummaries(
      roster.players.filter((player) => missingDiscordIds.includes(player.discordId))
    );

    if (runId !== enrichmentRunId) {
      return;
    }

    await setPlayerProfileSummaries({
      matchCode: roster.matchCode,
      profiles: {
        ...retainedProfiles,
        ...fetchedProfiles
      },
      loadingDiscordIds: [],
      updatedAt: Date.now()
    });
  } catch (caught) {
    if (runId !== enrichmentRunId) {
      return;
    }

    console.warn('[UmaLytics] Profile scouting failed:', caught);
    await setPlayerProfileSummaries({
      matchCode: roster.matchCode,
      profiles: retainedProfiles,
      loadingDiscordIds: [],
      updatedAt: Date.now()
    });
  }
}

function getRetainedProfiles(
  cachedProfiles: Record<string, PlayerProfileSummary>,
  freshProfiles: Record<string, PlayerProfileSummary>,
  discordIds: string[]
): Record<string, PlayerProfileSummary> {
  return Object.fromEntries(
    discordIds
      .map((discordId) => [discordId, cachedProfiles[discordId] ?? freshProfiles[discordId]] as const)
      .filter((entry): entry is readonly [string, PlayerProfileSummary] => entry[1] !== undefined)
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
