import { injectScript } from 'wxt/utils/inject-script';
import type { ScriptPublicPath } from 'wxt/utils/inject-script';
import type { DraftSnapshot, PrematchRoster } from '@umalytics/shared';
import { extractMatchCodeFromUrl } from '../utils/matchDetection';
import { sendDraftSnapshot, sendPrematchRoster } from '../utils/messaging';
import {
  extractPrematchRosterFromRoomDom,
  extractRoomCodeFromRoomDom
} from '../utils/domLobbyExtraction';
import {
  extractDraftSnapshotFromDraftDom,
  extractDraftSnapshotFromSyncedDraftState
} from '../utils/draftExtraction';
import { extractPrematchRosterFromSyncedDraftState } from '../utils/playerExtraction';

const SYNCED_DRAFT_STATE_MESSAGE_TYPE = 'umalytics:synced-draft-state';
const PAGE_HOOK_SCRIPT_PATH = '/pageHook.js' as ScriptPublicPath;
const CONTENT_SCRIPT_INSTALL_FLAG = '__umalyticsContentScriptInstalled';
const ROOM_DOM_SCAN_DEBOUNCE_MS = 750;
const ROOM_DOM_RETRY_DELAYS_MS = [250, 1_000, 2_500, 5_000, 10_000, 20_000] as const;
type RosterSource = 'dom' | 'synced';
type UmaLyticsWindow = Window & {
  [CONTENT_SCRIPT_INSTALL_FLAG]?: boolean;
};

let lastRosterSignature: string | undefined;
let lastRosterMatchCode: string | undefined;
let lastRosterSource: RosterSource | undefined;
let lastDraftSnapshotSignature: string | undefined;
let lastIgnoredStaleSyncedMatchCode: string | undefined;
let activeRoomDomMatchCode: string | undefined;
let roomDomScanTimer: number | undefined;
let roomDomRetryTimers: number[] = [];
let roomDomObserver: MutationObserver | undefined;
let isContentScriptActive = true;

export default defineContentScript({
  matches: ['https://drafter.uma.guide/*'],
  runAt: 'document_start',
  async main() {
    const pageWindow = window as UmaLyticsWindow;

    if (pageWindow[CONTENT_SCRIPT_INSTALL_FLAG] === true) {
      return;
    }

    pageWindow[CONTENT_SCRIPT_INSTALL_FLAG] = true;
    console.log('[UmaLytics] Extension loaded');

    const initialMatchCode = getCurrentMatchCode();

    if (initialMatchCode !== undefined) {
      console.log(`[UmaLytics] Match detected: ${initialMatchCode}`);
    }

    window.addEventListener('message', handlePageMessage);
    window.addEventListener('focus', handlePageFocus);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    installRoomDomObserver();
    scheduleRoomDomRetries();

    try {
      await injectScript(PAGE_HOOK_SCRIPT_PATH, { keepInDom: true });
    } catch (caught) {
      if (isExtensionContextInvalidatedError(caught)) {
        deactivateContentScript();
        return;
      }

      throw caught;
    }
  }
});

function handlePageMessage(event: MessageEvent<unknown>): void {
  if (!isContentScriptActive) {
    return;
  }

  void handleWindowMessage(event.data, getCurrentMatchCode());
}

function handlePageFocus(): void {
  queueRoomDomScan();
}

function handlePageShow(): void {
  queueRoomDomScan();
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    installRoomDomObserver();
    queueRoomDomScan();
    scheduleRoomDomRetries();
    return;
  }

  clearRoomDomRetries();
  clearPendingRoomDomScan();
  roomDomObserver?.disconnect();
  roomDomObserver = undefined;
}

async function handleWindowMessage(message: unknown, matchCode?: string): Promise<void> {
  if (!isContentScriptActive) {
    return;
  }

  if (!isRecord(message) || message.type !== SYNCED_DRAFT_STATE_MESSAGE_TYPE) {
    return;
  }

  refreshActiveRoomDomMatchCode(matchCode);
  await publishSyncedDraftSnapshot(message.payload, matchCode);

  const roster = extractPrematchRosterFromSyncedDraftState(message.payload, matchCode);

  if (roster === null || roster.players.length !== 10) {
    return;
  }

  if (isStaleSyncedRoster(roster)) {
    if (roster.matchCode !== lastIgnoredStaleSyncedMatchCode) {
      console.debug('[UmaLytics] Ignoring stale synced roster:', roster.matchCode);
      lastIgnoredStaleSyncedMatchCode = roster.matchCode;
    }

    return;
  }

  await publishRoster(roster, 'synced');
}

function installRoomDomObserver(): void {
  if (roomDomObserver !== undefined || document.visibilityState === 'hidden') {
    return;
  }

  queueRoomDomScan();

  roomDomObserver = new MutationObserver(() => {
    queueRoomDomScan();
  });

  roomDomObserver.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true
  });
}

function scheduleRoomDomRetries(): void {
  clearRoomDomRetries();

  roomDomRetryTimers = ROOM_DOM_RETRY_DELAYS_MS.map((delayMs) =>
    window.setTimeout(() => {
      queueRoomDomScan();
    }, delayMs)
  );
}

function clearRoomDomRetries(): void {
  for (const timer of roomDomRetryTimers) {
    window.clearTimeout(timer);
  }

  roomDomRetryTimers = [];
}

function queueRoomDomScan(): void {
  if (!isContentScriptActive || document.visibilityState === 'hidden') {
    return;
  }

  if (roomDomScanTimer !== undefined) {
    return;
  }

  roomDomScanTimer = window.setTimeout(() => {
    roomDomScanTimer = undefined;
    void publishRoomDomRoster();
  }, ROOM_DOM_SCAN_DEBOUNCE_MS);
}

function clearPendingRoomDomScan(): void {
  if (roomDomScanTimer === undefined) {
    return;
  }

  window.clearTimeout(roomDomScanTimer);
  roomDomScanTimer = undefined;
}

async function publishRoomDomRoster(): Promise<void> {
  if (!isContentScriptActive) {
    return;
  }

  await publishDomDraftSnapshot();

  const roster = extractPrematchRosterFromRoomDom(document);

  if (roster === null) {
    refreshActiveRoomDomMatchCode(getCurrentMatchCode());
    return;
  }

  activeRoomDomMatchCode = roster.matchCode;
  clearRoomDomRetries();
  await publishRoster(roster, 'dom');
}

async function publishSyncedDraftSnapshot(payload: unknown, matchCode?: string): Promise<void> {
  const snapshot = extractDraftSnapshotFromSyncedDraftState(payload, matchCode);

  if (snapshot === null || isStaleDraftSnapshot(snapshot)) {
    return;
  }

  await publishDraftSnapshot(snapshot);
}

async function publishDomDraftSnapshot(): Promise<void> {
  const snapshot = extractDraftSnapshotFromDraftDom(document);

  if (snapshot === null) {
    return;
  }

  await publishDraftSnapshot(snapshot);
}

async function publishDraftSnapshot(snapshot: DraftSnapshot): Promise<void> {
  const signature = getDraftSnapshotSignature(snapshot);

  if (signature === lastDraftSnapshotSignature) {
    return;
  }

  lastDraftSnapshotSignature = signature;

  try {
    await sendDraftSnapshot(snapshot);
  } catch (caught) {
    if (isExtensionContextInvalidatedError(caught)) {
      deactivateContentScript();
      return;
    }

    throw caught;
  }
}

async function publishRoster(roster: PrematchRoster, source: RosterSource): Promise<void> {
  if (roster.players.length === 0) {
    return;
  }

  if (
    source === 'dom' &&
    lastRosterSource === 'synced' &&
    lastRosterMatchCode === roster.matchCode
  ) {
    return;
  }

  const rosterSignature = getRosterSignature(roster);

  if (rosterSignature === lastRosterSignature) {
    return;
  }

  console.log(`[UmaLytics] Roster detected: ${roster.players.length} players`);
  lastRosterSignature = rosterSignature;
  lastRosterMatchCode = roster.matchCode;
  lastRosterSource = source;

  try {
    await sendPrematchRoster(roster);
  } catch (caught) {
    if (isExtensionContextInvalidatedError(caught)) {
      deactivateContentScript();
      return;
    }

    throw caught;
  }
}

function isStaleSyncedRoster(roster: PrematchRoster): boolean {
  if (activeRoomDomMatchCode === undefined) {
    return false;
  }

  return roster.matchCode !== activeRoomDomMatchCode;
}

function isStaleDraftSnapshot(snapshot: DraftSnapshot): boolean {
  if (activeRoomDomMatchCode === undefined || snapshot.matchCode === undefined) {
    return false;
  }

  return snapshot.matchCode !== activeRoomDomMatchCode;
}

function refreshActiveRoomDomMatchCode(fallbackMatchCode?: string): void {
  const visibleRoomDomMatchCode = extractRoomCodeFromRoomDom(document);

  if (visibleRoomDomMatchCode !== undefined) {
    activeRoomDomMatchCode = visibleRoomDomMatchCode;
    return;
  }

  if (
    fallbackMatchCode !== undefined &&
    activeRoomDomMatchCode !== undefined &&
    fallbackMatchCode !== activeRoomDomMatchCode
  ) {
    activeRoomDomMatchCode = undefined;
  }
}

function getRosterSignature(roster: { matchCode?: string; players: Array<{ userId: string; team?: string }> }): string {
  const playerSignature = roster.players
    .map((player) => `${player.userId}:${player.team ?? 'unknown'}`)
    .sort()
    .join('|');

  return `${roster.matchCode ?? 'unknown'}:${playerSignature}`;
}

function getDraftSnapshotSignature(snapshot: DraftSnapshot): string {
  const teamSignature = Object.values(snapshot.teams)
    .map((team) => {
      const mapSignature = team.maps
        .map((map) => `${map.order ?? ''}:${map.name}:${map.status ?? ''}`)
        .join(',');
      const umaSignature = team.umas
        .map((uma) => `${uma.kind}:${uma.order ?? ''}:${uma.umaId ?? uma.name}`)
        .join(',');

      return `${team.id}:${team.name ?? ''}:maps[${mapSignature}]:umas[${umaSignature}]`;
    })
    .sort()
    .join('|');

  const tiebreakerSignature = snapshot.tiebreakerMap === undefined
    ? ''
    : `${snapshot.tiebreakerMap.name}:${snapshot.tiebreakerMap.details ?? ''}`;

  return `${snapshot.matchCode ?? 'unknown'}:${snapshot.phase ?? ''}:${snapshot.currentTeam ?? ''}:${tiebreakerSignature}:${teamSignature}`;
}

function getCurrentMatchCode(): string | undefined {
  return extractMatchCodeFromUrl(window.location.href);
}

function deactivateContentScript(): void {
  if (!isContentScriptActive) {
    return;
  }

  isContentScriptActive = false;
  window.removeEventListener('message', handlePageMessage);
  window.removeEventListener('focus', handlePageFocus);
  window.removeEventListener('pageshow', handlePageShow);
  document.removeEventListener('visibilitychange', handleVisibilityChange);

  clearPendingRoomDomScan();
  clearRoomDomRetries();
  roomDomObserver?.disconnect();
  roomDomObserver = undefined;
  delete (window as UmaLyticsWindow)[CONTENT_SCRIPT_INSTALL_FLAG];
  console.debug('[UmaLytics] Disabled stale content script after extension reload.');
}

function isExtensionContextInvalidatedError(caught: unknown): boolean {
  return caught instanceof Error && caught.message.includes('Extension context invalidated');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
