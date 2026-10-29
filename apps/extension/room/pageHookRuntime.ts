import { decodeRoomEvent } from '@umalytics/core/room/roomEvents';
import { selectRoomSyncedState } from '@umalytics/core/room/syncPayload';
import { extractMatchCodeFromUrl } from '@umalytics/core/room/matchDetection';
import { extractRoomCodeFromRoomDom } from './domLobbyExtraction';
const SYNCED_DRAFT_STATE_MESSAGE_TYPE = 'umalytics:synced-draft-state';
const SYNC_EFFECT_LOG_PREFIX = '[SYNC EFFECT] Starting sync';
const INSTALL_FLAG = '__umalyticsRoomHookInstalled';
// Socket.IO prefixes the event array with a short frame code, so the envelope
// name appears within the first few characters of every room event frame.
const SERVER_EVENT_MARKER = '"server:event"';
const SERVER_EVENT_HEAD_LENGTH = 48;

type HookSource = 'console' | 'websocket';
type UmaLyticsWindow = Window & {
  [INSTALL_FLAG]?: boolean;
};

export function installPageHook(): void {
  const pageWindow = window as UmaLyticsWindow;

  if (pageWindow[INSTALL_FLAG] === true) {
    return;
  }

  pageWindow[INSTALL_FLAG] = true;
  installSyncConsoleHook();
  installWebSocketHook();
  window.addEventListener('message', replayRoomEvents);
}

function installSyncConsoleHook(): void {
  const methods = ['debug', 'log', 'info'] as const;

  for (const method of methods) {
    const originalMethod = window.console[method].bind(window.console);

    window.console[method] = (...args: unknown[]) => {
      // The site's own logging must never fail because of this inspection.
      try {
        if (args[0] === SYNC_EFFECT_LOG_PREFIX) {
          for (const arg of args.slice(1)) {
            inspectPossiblePayload(arg, 'console');
          }
        }
      } catch {
        // Ignore payloads that cannot be inspected or cloned.
      }

      originalMethod(...args);
    };
  }
}

function installWebSocketHook(): void {
  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = new Proxy(OriginalWebSocket, {
    construct(target, args: ConstructorParameters<typeof WebSocket>) {
      const socket = new target(...args);

      socket.addEventListener('message', (event: MessageEvent<unknown>) => {
        try {
          inspectPossiblePayload(event.data, 'websocket');
        } catch {
          // A frame this hook cannot read must not disturb the site's socket.
        }
      });

      return socket;
    }
  });
}

function inspectPossiblePayload(payload: unknown, source: HookSource, capturedRoom?: string): void {
  if (typeof payload === 'string') {
    inspectPossibleJson(payload, source, capturedRoom);
    return;
  }

  if (payload instanceof Blob) {
    if (source === 'websocket' && payload.size > SERVER_EVENT_HEAD_LENGTH) {
      // Read only the head of binary frames; most are not room events.
      void payload.slice(0, SERVER_EVENT_HEAD_LENGTH).text().then(head => {
        if (!head.includes(SERVER_EVENT_MARKER)) return;
        return payload.text().then(text => inspectPossibleJson(text, source, capturedRoom));
      }).catch(() => {
        // Ignore undecodable socket frames.
      });
      return;
    }

    void payload.text().then(text => inspectPossibleJson(text, source, capturedRoom)).catch(() => {
      // Ignore undecodable socket frames.
    });
    return;
  }

  if (payload instanceof ArrayBuffer) {
    if (source === 'websocket' && payload.byteLength > SERVER_EVENT_HEAD_LENGTH &&
        !new TextDecoder().decode(payload.slice(0, SERVER_EVENT_HEAD_LENGTH)).includes(SERVER_EVENT_MARKER)) {
      return;
    }

    inspectPossibleJson(new TextDecoder().decode(payload), source, capturedRoom);
    return;
  }

  if (source === 'websocket') {
    const event = decodeRoomEvent(payload);
    if (event !== null) {
      rememberRoomEvent(event);
      // Live events are always forwarded; the extension's reducer decides which
      // are stale. Only the replay buffer below keeps the newest version.
      window.postMessage({ type: 'umalytics:room-event', payload: event, hookVersion: 4 }, window.location.origin);
    }
    return;
  }
  // Stored snapshots are not proof of the active roster. Live console fallback
  // is only used until a typed match snapshot has arrived.
  if (source !== 'console') return;
  const syncedDraftState = selectRoomSyncedState(payload, capturedRoom ?? getVisibleRoomCode(), true);

  if (syncedDraftState !== null) {
    postSyncedDraftState(syncedDraftState, source);
  }
}

function postSyncedDraftState(syncedDraftState: unknown, source: HookSource): void {
  try {
    window.postMessage(
      {
        type: SYNCED_DRAFT_STATE_MESSAGE_TYPE,
        payload: syncedDraftState,
        source,
        hookVersion: 4
      },
      window.location.origin
    );
  } catch {
    // Page objects can hold functions or DOM nodes that cannot be cloned.
  }
}

function inspectPossibleJson(value: string, source: HookSource, capturedRoom?: string): void {
  // Only server:event frames can carry room events, so check the head before
  // scanning or parsing a potentially large frame.
  if (source === 'websocket') {
    if (!value.slice(0, SERVER_EVENT_HEAD_LENGTH).includes(SERVER_EVENT_MARKER)) return;
  } else if (
    !value.includes('server:event') &&
    !value.includes('rankedQueueRoster') &&
    !value.includes('syncedDraftState_multiplayer') &&
    !value.includes('participants') &&
    !value.includes('roomPlayers') &&
    !value.includes('players') &&
    !value.includes('actorUserId')
  ) {
    return;
  }

  for (const candidate of getJsonCandidates(value)) {
    try {
      inspectPossiblePayload(JSON.parse(candidate), source, capturedRoom);
      return;
    } catch {
      // Try the next candidate; realtime protocols can prefix JSON with frame codes.
    }
  }
}

function getJsonCandidates(value: string): string[] {
  if (value.length > 2_000_000) return [];
  const candidates = [value];
  // Socket.IO numeric prefixes occur before the first JSON container. Never
  // allocate a suffix for every bracket inside a large profile/roster frame.
  const index = value.search(/[\[{]/);
  if (index > 0 && index < 100) candidates.push(value.slice(index));

  return candidates;
}

function getVisibleRoomCode(): string | undefined {
  return extractMatchCodeFromUrl(window.location.href) ?? extractRoomCodeFromRoomDom(document);
}

// Only sanitized room events are retained, never raw socket frames or credentials.
const capturedRoomEvents = new Map<string, Record<string, any>>();
function rememberRoomEvent(event: Record<string, any>): void {
  const key = event.matchId + ':' + event.type + ':' + (event.team ?? '');
  const previous = capturedRoomEvents.get(key);
  const previousVersion = previous?.version ?? previous?.revision;
  const nextVersion = event.version ?? event.revision;
  if (typeof previousVersion === 'number' && typeof nextVersion === 'number' && nextVersion <= previousVersion) return;
  capturedRoomEvents.delete(key);
  capturedRoomEvents.set(key, event);
  if (capturedRoomEvents.size > 32) capturedRoomEvents.delete(capturedRoomEvents.keys().next().value!);
}

function replayRoomEvents(message: MessageEvent<unknown>): void {
  if (message.source !== window || message.origin !== window.location.origin) return;
  const data = message.data;
  if (data === null || typeof data !== 'object' || !('type' in data) || data.type !== 'umalytics:request-room-events') return;
  const room = getVisibleRoomCode();
  if (room === undefined) return;
  for (const event of capturedRoomEvents.values()) {
    if (event.matchId === room) window.postMessage({ type: 'umalytics:room-event', payload: event, hookVersion: 4 }, window.location.origin);
  }
}
