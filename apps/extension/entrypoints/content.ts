import { decodeRoomEvent, RoomEventState } from '../utils/roomEvents';
import { canReuseSyncedRoster } from '../utils/rosterIdentity';
import { browser } from 'wxt/browser';
import { injectScript } from 'wxt/utils/inject-script';
import type { ScriptPublicPath } from 'wxt/utils/inject-script';
import type { DraftSnapshot, PrematchRoster } from '@umalytics/shared';
import { extractMatchCodeFromUrl } from '../utils/matchDetection';
import {
  isUmaLyticsContentMessage,
  sendDraftSnapshot,
  sendDiagnosticEvent,
  sendPrematchRoster,
  type RoomDomScanResult
} from '../utils/messaging';
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
const CONTENT_SCRIPT_CLEANUP_KEY = '__umalyticsContentScriptCleanup';
const ROOM_DOM_SCAN_DEBOUNCE_MS = 100;
const ROOM_DOM_RETRY_DELAYS_MS = [250, 1_000, 2_500, 5_000, 10_000, 20_000] as const;
type RosterSource = 'dom' | 'synced';
type UmaLyticsWindow = Window & {
  [CONTENT_SCRIPT_CLEANUP_KEY]?: () => void;
};

const roomEvents = new RoomEventState();
const pendingRoomEvents = new Map<string, { event: Record<string, unknown>; at: number }>();
let lastRosterSignature: string | undefined;
let lastRosterMatchCode: string | undefined;
let lastRosterSource: RosterSource | undefined;
let lastPublishedRoster: PrematchRoster | undefined;
let lastDraftSnapshotSignature: string | undefined;
let lastDraftSnapshot: DraftSnapshot | undefined;
let rosterPublishQueue = Promise.resolve();
let windowMessageQueue = Promise.resolve();
const pendingRosters = new Map<string, Promise<void>>();
let draftPublishQueue = Promise.resolve();
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
    const previousCleanup = pageWindow[CONTENT_SCRIPT_CLEANUP_KEY];

    if (previousCleanup !== undefined) {
      try {
        previousCleanup();
      } catch (caught) {
        console.debug('[UmaLytics] Previous content script cleanup skipped:', caught);
      }
    }

    isContentScriptActive = true;
    pageWindow[CONTENT_SCRIPT_CLEANUP_KEY] = deactivateContentScript;

    window.addEventListener('message', handlePageMessage);
    window.addEventListener('focus', handlePageFocus);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    browser.runtime.onMessage.addListener(handleRuntimeMessage);

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

  if (event.source !== window || event.origin !== window.location.origin) {
    return;
  }

  void handleWindowMessage(event.data, getCurrentMatchCode()).catch((error) => console.debug('[UmaLytics] Sync update failed:', error));
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

function handleRuntimeMessage(message: unknown): Promise<RoomDomScanResult> | undefined {
  if (!isContentScriptActive || !isUmaLyticsContentMessage(message)) {
    return undefined;
  }

  return publishRoomDomRoster({ force: message.force === true });
}

function handleWindowMessage(message: unknown, matchCode?: string): Promise<void> {
  const href = typeof window === 'undefined' ? undefined : window.location.href;
  const run = windowMessageQueue.then(() => {
    if (href !== undefined && href !== window.location.href) return;
    return processWindowMessage(message, matchCode);
  });
  windowMessageQueue = run.catch(() => {});
  return run;
}

async function processWindowMessage(message: unknown, matchCode?: string): Promise<void> {
  if (!isContentScriptActive) {
    return;
  }

  if (isRecord(message) && message.type === 'umalytics:room-event' && message.hookVersion === 4) {
    refreshActiveRoomDomMatchCode(matchCode);
    const event = decodeRoomEvent(message.payload);
    if (event !== null && event.matchId !== activeRoomDomMatchCode) {
      const key = event.matchId + ':' + event.type + ':' + (event.team ?? '');
      const previous = pendingRoomEvents.get(key)?.event;
      const oldVersion = previous?.version ?? previous?.revision;
      const newVersion = event.version ?? event.revision;
      if (typeof oldVersion === 'number' && typeof newVersion === 'number' && oldVersion > newVersion) return;
      pendingRoomEvents.delete(key);
      pendingRoomEvents.set(key, { event, at: Date.now() });
      if (pendingRoomEvents.size > 8) pendingRoomEvents.delete(pendingRoomEvents.keys().next().value!);
    }
    const update = roomEvents.apply(message.payload, activeRoomDomMatchCode);
    void sendDiagnosticEvent({ kind: 'room', reason: update.reason, room: activeRoomDomMatchCode,
      version: roomEvents.version, phase: update.draft?.phase,
      team1: update.roster?.players.filter(p => p.team === 'team1').length,
      team2: update.roster?.players.filter(p => p.team === 'team2').length }).catch(() => {});
    if (update.draft) await publishDraftSnapshot(update.draft);
    if (update.roster) await publishRoster(update.roster, 'synced');
    return;
  }
  if (!isRecord(message) || message.type !== SYNCED_DRAFT_STATE_MESSAGE_TYPE) {
    return;
  }

  if (message.hookVersion !== 4 || !['console', 'websocket', 'storage'].includes(String(message.source))) return;
  refreshActiveRoomDomMatchCode(matchCode);
  if (roomEvents.draft?.matchCode === activeRoomDomMatchCode && roomEvents.draft !== undefined) return;
  const draftPublication = publishSyncedDraftSnapshot(message.payload, matchCode);
  void draftPublication.catch(error => console.debug('[UmaLytics] Draft sync failed:', error));

  const roster = extractPrematchRosterFromSyncedDraftState(message.payload);

  if (roster === null) {
    return;
  }

  if (isStaleSyncedRoster(roster)) {
    if (roster.matchCode !== lastIgnoredStaleSyncedMatchCode) {
      console.debug('[UmaLytics] Ignoring stale synced roster:', roster.matchCode);
      lastIgnoredStaleSyncedMatchCode = roster.matchCode;
    }

    return;
  }

  await publishRoster({ ...roster, observationSource: String(message.source) }, 'synced');
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
    void publishRoomDomRoster().catch((error) => console.debug('[UmaLytics] DOM update failed:', error));
  }, ROOM_DOM_SCAN_DEBOUNCE_MS);
}

function clearPendingRoomDomScan(): void {
  if (roomDomScanTimer === undefined) {
    return;
  }

  window.clearTimeout(roomDomScanTimer);
  roomDomScanTimer = undefined;
}

async function publishRoomDomRoster(
  options: { force?: boolean } = {}
): Promise<RoomDomScanResult> {
  if (!isContentScriptActive) {
    return { activeLobby: false };
  }

  await publishDomDraftSnapshot();

  const roster = extractPrematchRosterFromRoomDom(document);

  if (roster === null) {
    refreshActiveRoomDomMatchCode(getCurrentMatchCode());
    if (options.force && lastPublishedRoster !== undefined &&
        lastPublishedRoster.matchCode !== undefined && lastPublishedRoster.matchCode === (getCurrentMatchCode() ?? activeRoomDomMatchCode)) {
      await publishRoster(lastPublishedRoster, lastRosterSource ?? 'synced', options);
      return { activeLobby: true, matchCode: lastPublishedRoster.matchCode };
    }
    return { activeLobby: false };
  }

  activeRoomDomMatchCode = getCurrentMatchCode() ?? roster.matchCode;
  clearRoomDomRetries();
  for (const [key, pending] of pendingRoomEvents) {
    if (Date.now() - pending.at > 30_000) { pendingRoomEvents.delete(key); continue; }
    if (pending.event.matchId !== activeRoomDomMatchCode) continue;
    pendingRoomEvents.delete(key);
    await handleWindowMessage({ type: 'umalytics:room-event', hookVersion: 4, payload: pending.event }, activeRoomDomMatchCode);
  }
  await publishRoster(roster, 'dom', options);
  return { activeLobby: true, matchCode: roster.matchCode };
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

function publishDraftSnapshot(snapshot: DraftSnapshot): Promise<void> {
  const publication = draftPublishQueue.then(() => publishDraftSnapshotInOrder(snapshot));
  draftPublishQueue = publication.catch(() => {});
  return publication;
}

async function publishDraftSnapshotInOrder(snapshot: DraftSnapshot): Promise<void> {
  if (!isContentScriptActive) return;
  const matchCode = snapshot.matchCode ?? getCurrentMatchCode() ?? activeRoomDomMatchCode;
  if (matchCode === undefined) return;
  snapshot = { ...snapshot, matchCode };
  if (isStaleDraftSnapshot(snapshot)) return;
  if (snapshot.source === 'draft-dom' && roomEvents.draft?.matchCode === matchCode) return;
  if (snapshot.source === 'draft-dom' && lastDraftSnapshot?.matchCode === matchCode) {
    // DOM picks/maps can advance, but DOM extraction has no phase/turn fields.
    snapshot = { ...snapshot, phase: snapshot.phase ?? lastDraftSnapshot.phase,
      currentTeam: snapshot.currentTeam ?? lastDraftSnapshot.currentTeam };
  }
  const signature = getDraftSnapshotSignature(snapshot);

  if (signature === lastDraftSnapshotSignature) {
    return;
  }

  try {
    await sendDraftSnapshot(snapshot);
  } catch (caught) {
    if (isExtensionContextInvalidatedError(caught)) {
      deactivateContentScript();
      return;
    }

    if (isTransientRuntimeMessageError(caught)) {
      return;
    }

    throw caught;
  }

  lastDraftSnapshotSignature = signature;
  lastDraftSnapshot = snapshot;
}

function publishRoster(roster: PrematchRoster, source: RosterSource, options: { force?: boolean } = {}): Promise<void> {
  if (options.force && source === 'dom' && lastRosterSource === 'synced' &&
      lastPublishedRoster !== undefined && canReuseSyncedRoster(lastPublishedRoster, roster)) {
    roster = lastPublishedRoster;
    source = 'synced';
  }
  const key = getRosterSignature(roster);
  const pending = pendingRosters.get(key);
  if (pending !== undefined) return pending;
  const publication = rosterPublishQueue.then(() => publishRosterInOrder(roster, source, options));
  pendingRosters.set(key, publication);
  rosterPublishQueue = publication.catch(() => {});
  void publication.finally(() => { if (pendingRosters.get(key) === publication) pendingRosters.delete(key); }).catch(() => {});
  return publication;
}

async function publishRosterInOrder(
  roster: PrematchRoster,
  source: RosterSource,
  options: { force?: boolean } = {}
): Promise<void> {
  if (!isContentScriptActive) {
    return;
  }

  if (
    source === 'dom' &&
    lastRosterSource === 'synced' &&
    lastPublishedRoster !== undefined && canReuseSyncedRoster(lastPublishedRoster, roster)
  ) {
    return;
  }

  const rosterSignature = getRosterSignature(roster);

  if (options.force !== true && rosterSignature === lastRosterSignature) {
    return;
  }

  try {
    await sendPrematchRoster(roster);
  } catch (caught) {
    if (isExtensionContextInvalidatedError(caught)) {
      deactivateContentScript();
      return;
    }

    if (isTransientRuntimeMessageError(caught)) {
      return;
    }

    throw caught;
  }

  void sendDiagnosticEvent({ kind: 'roster', room: roster.matchCode, reason: source,
    team1: roster.players.filter(p => p.team === 'team1').length,
    team2: roster.players.filter(p => p.team === 'team2').length }).catch(() => {});
  lastRosterSignature = rosterSignature;
  lastRosterMatchCode = roster.matchCode;
  lastRosterSource = source;
  lastPublishedRoster = roster;
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
  if (fallbackMatchCode !== undefined) {
    activeRoomDomMatchCode = fallbackMatchCode;
    return;
  }
  const visibleRoomDomMatchCode = extractRoomCodeFromRoomDom(document);
  activeRoomDomMatchCode = visibleRoomDomMatchCode;

  if (visibleRoomDomMatchCode !== undefined) {
    activeRoomDomMatchCode = visibleRoomDomMatchCode;
    return;
  }

}

function getRosterSignature(roster: PrematchRoster): string {
  return JSON.stringify({ ...roster, players: [...roster.players].sort((a, b) => a.userId.localeCompare(b.userId)) });
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

  return `${snapshot.version ?? ''}:${JSON.stringify(snapshot.rules)}:${snapshot.matchCode ?? 'unknown'}:${snapshot.phase ?? ''}:${snapshot.currentTeam ?? ''}:${tiebreakerSignature}:${teamSignature}`;
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
  browser.runtime.onMessage.removeListener(handleRuntimeMessage);

  clearPendingRoomDomScan();
  clearRoomDomRetries();
  roomDomObserver?.disconnect();
  roomDomObserver = undefined;

  const pageWindow = window as UmaLyticsWindow;

  if (pageWindow[CONTENT_SCRIPT_CLEANUP_KEY] === deactivateContentScript) {
    delete pageWindow[CONTENT_SCRIPT_CLEANUP_KEY];
  }

  console.debug('[UmaLytics] Disabled stale content script after extension reload.');
}

function isExtensionContextInvalidatedError(caught: unknown): boolean {
  return caught instanceof Error && caught.message.includes('Extension context invalidated');
}

function isTransientRuntimeMessageError(caught: unknown): boolean {
  if (!(caught instanceof Error)) {
    return false;
  }

  return (
    caught.message.includes('A listener indicated an asynchronous response') ||
    caught.message.includes('message channel closed') ||
    caught.message.includes('The message port closed before a response was received') ||
    caught.message.includes('Could not establish connection. Receiving end does not exist')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
