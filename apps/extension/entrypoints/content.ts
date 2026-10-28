import { decodeRoomEvent, RoomEventState, summarizeRoomEvent } from '../room/roomEvents';
import { canReuseSyncedRoster } from '../room/rosterIdentity';
import { browser } from 'wxt/browser';
import type { DraftSnapshot, PrematchRoster } from '@umalytics/shared';
import { extractMatchCodeFromUrl } from '../room/matchDetection';
import {
  isUmaLyticsContentMessage,
  sendDraftSnapshot,
  sendDiagnosticEvent,
  sendPrematchRoster,
  type RoomDomScanResult
} from '../runtime/messaging';
import {
  extractPrematchRosterFromRoomDom,
  extractRoomCodeFromRoomDom
} from '../room/domLobbyExtraction';
import {
  extractDraftSnapshotFromDraftDom,
  extractDraftSnapshotFromSyncedDraftState
} from '../room/draftExtraction';
import { extractPrematchRosterFromSyncedDraftState } from '../room/playerExtraction';
import { isRecord } from '../room/recordReaders';

const SYNCED_DRAFT_STATE_MESSAGE_TYPE = 'umalytics:synced-draft-state';
const CONTENT_SCRIPT_CLEANUP_KEY = '__umalyticsContentScriptCleanup';
const ROOM_DOM_SCAN_DEBOUNCE_MS = 100;
// DOM mutations can arrive continuously; they trigger a scan at most this often.
const ROOM_DOM_MUTATION_SCAN_INTERVAL_MS = 500;
const ROOM_DOM_RETRY_DELAYS_MS = [250, 1_000, 2_500, 5_000, 10_000, 20_000] as const;
type RosterSource = 'dom' | 'synced';
type UmaLyticsWindow = Window & {
  [CONTENT_SCRIPT_CLEANUP_KEY]?: () => void;
};

const roomEvents = new RoomEventState();
let lastRosterSignature: string | undefined;
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
let activeRoomPageHref: string | undefined;
let roomDomScanTimer: number | undefined;
let roomDomScanDueAt = 0;
let lastRoomDomScanAt = 0;
let roomDomRetryTimers: number[] = [];
let roomDomObserver: MutationObserver | undefined;
let isContentScriptActive = true;

export default defineContentScript({
  matches: ['https://drafter.uma.guide/*'],
  runAt: 'document_start',
  main() {
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
    // The page hook is a separate MAIN-world content script (roomHook.content),
    // installed at document start. Ask it to replay anything it already captured.
    requestCapturedRoomEvents();
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

function requestCapturedRoomEvents(): void {
  window.postMessage({ type: 'umalytics:request-room-events' }, window.location.origin);
}

function handlePageFocus(): void {
  requestCapturedRoomEvents();
  queueRoomDomScan();
}

function handlePageShow(): void {
  requestCapturedRoomEvents();
  queueRoomDomScan();
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    requestCapturedRoomEvents();
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
  const href = window.location.href;
  const run = windowMessageQueue.then(() => {
    if (href !== window.location.href) return;
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
    // Events that arrive before the room identity is visible are kept by the
    // page hook and replayed on request once refreshActiveRoomDomMatchCode
    // sees the room, so nothing is buffered here.
    const event = decodeRoomEvent(message.payload);
    const update = roomEvents.apply(message.payload, activeRoomDomMatchCode);
    void sendDiagnosticEvent({ kind: 'room', reason: update.reason, room: activeRoomDomMatchCode,
      ...summarizeRoomEvent(event), version: roomEvents.version, phase: update.draft?.phase ?? roomEvents.draft?.phase,
      team1: update.roster?.players.filter(p => p.team === 'team1').length,
      team2: update.roster?.players.filter(p => p.team === 'team2').length }).catch(() => {});
    if (update.draft) await publishDraftSnapshot(update.draft);
    if (update.roster) await publishRoster(update.roster, 'synced');
    return;
  }
  if (!isRecord(message) || message.type !== SYNCED_DRAFT_STATE_MESSAGE_TYPE) {
    return;
  }

  // The hook forwards only console sync logs on this channel; room events use
  // their own message type.
  if (message.hookVersion !== 4 || message.source !== 'console') return;
  refreshActiveRoomDomMatchCode(matchCode);
  // Typed room events are authoritative; the console fallback is only for
  // rooms they have not described yet.
  if (roomEventsOwnActiveRoom()) return;
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

  await publishRoster({ ...roster, observationSource: 'console' }, 'synced');
}

function installRoomDomObserver(): void {
  if (roomDomObserver !== undefined || document.visibilityState === 'hidden') {
    return;
  }

  queueRoomDomScan();

  roomDomObserver = new MutationObserver(() => {
    queueRoomDomScan(ROOM_DOM_MUTATION_SCAN_INTERVAL_MS);
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

/** Schedule a DOM scan. `minIntervalMs` spaces scans triggered by continuous
 * page mutations; events that need prompt attention keep the short debounce. */
function queueRoomDomScan(minIntervalMs = 0): void {
  if (!isContentScriptActive || document.visibilityState === 'hidden') {
    return;
  }

  const now = Date.now();
  const dueAt = now + Math.max(ROOM_DOM_SCAN_DEBOUNCE_MS, lastRoomDomScanAt + minIntervalMs - now);

  // A scan that is already due as soon as this one would be covers it.
  if (roomDomScanTimer !== undefined) {
    if (roomDomScanDueAt <= dueAt) {
      return;
    }

    window.clearTimeout(roomDomScanTimer);
  }

  roomDomScanDueAt = dueAt;
  roomDomScanTimer = window.setTimeout(() => {
    roomDomScanTimer = undefined;
    lastRoomDomScanAt = Date.now();
    void publishRoomDomRoster().catch((error) => console.debug('[UmaLytics] DOM update failed:', error));
  }, dueAt - now);
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

  refreshActiveRoomDomMatchCode(getCurrentMatchCode() ?? roster.matchCode);
  clearRoomDomRetries();
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
  // Room events describe the draft precisely; skip the costly DOM extraction
  // while they own this room.
  if (roomEventsOwnDraft(getCurrentMatchCode() ?? peekVisibleRoomCode())) {
    return;
  }

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
  if (snapshot.source === 'draft-dom' && roomEventsOwnDraft(matchCode)) return;
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
  // A forced publish must reach the background even when an identical normal
  // publish is still in flight, so the two never share a pending entry.
  const key = (options.force === true ? 'force:' : '') + getRosterSignature(roster);
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
  lastRosterSource = source;
  lastPublishedRoster = roster;
}

/** Room events have produced a roster or draft for the room being shown. */
function roomEventsOwnActiveRoom(): boolean {
  return activeRoomDomMatchCode !== undefined && roomEvents.matchCode === activeRoomDomMatchCode &&
    (roomEvents.roster !== undefined || roomEvents.draft !== undefined);
}

function roomEventsOwnDraft(matchCode: string | undefined): boolean {
  return matchCode !== undefined && roomEvents.draft !== undefined && roomEvents.draft.matchCode === matchCode;
}

/** The room shown right now, without changing any active-room state. Mirrors
 * refreshActiveRoomDomMatchCode, which keeps the previous room only while the
 * page address is unchanged. */
function peekVisibleRoomCode(): string | undefined {
  return extractRoomCodeFromRoomDom(document) ??
    (window.location.href === activeRoomPageHref ? activeRoomDomMatchCode : undefined);
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
  const previousRoom = activeRoomDomMatchCode;
  const href = window.location.href;
  const detectedRoom = fallbackMatchCode ?? extractRoomCodeFromRoomDom(document);
  // /host keeps its URL when the waiting-room header disappears during draft.
  // Absence of that label is not proof that the room changed.
  activeRoomDomMatchCode = detectedRoom ?? (href === activeRoomPageHref ? previousRoom : undefined);
  activeRoomPageHref = href;
  // The initial hook handshake can precede the room-code DOM. Ask again once
  // that identity becomes visible, without polling or reopening the socket.
  if (activeRoomDomMatchCode !== undefined && activeRoomDomMatchCode !== previousRoom) {
    requestCapturedRoomEvents();
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
