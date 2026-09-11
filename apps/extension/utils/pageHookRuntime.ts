import { decodeRoomEvent } from './roomEvents';
import { selectRoomSyncedState } from './syncPayload';
import { extractMatchCodeFromUrl } from './matchDetection';
import { extractRoomCodeFromRoomDom } from './domLobbyExtraction';
const SYNCED_DRAFT_STATE_MESSAGE_TYPE = 'umalytics:synced-draft-state';
const SYNC_EFFECT_LOG_PREFIX = '[SYNC EFFECT] Starting sync';
const INSTALL_FLAG = '__umalyticsPageHookInstalled_0_3_9';

type HookSource = 'console' | 'websocket' | 'storage';
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
      if (args[0] === SYNC_EFFECT_LOG_PREFIX) {
        for (const arg of args.slice(1)) {
          inspectPossiblePayload(arg, 'console');
        }
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
        inspectPossiblePayload(event.data, 'websocket');
      });

      return socket;
    }
  });

  window.WebSocket.prototype = OriginalWebSocket.prototype;
}

function inspectPossiblePayload(payload: unknown, source: HookSource, capturedRoom = getVisibleRoomCode()): void {
  if (typeof payload === 'string') {
    inspectPossibleJson(payload, source, capturedRoom);
    return;
  }

  if (payload instanceof Blob) {
    void payload.text().then(text => inspectPossibleJson(text, source, capturedRoom)).catch(() => {
      // Ignore undecodable socket frames.
    });
    return;
  }

  if (payload instanceof ArrayBuffer) {
    inspectPossibleJson(new TextDecoder().decode(payload), source, capturedRoom);
    return;
  }

  if (source === 'websocket') {
    const event = decodeRoomEvent(payload);
    if (event !== null) {
      const key = event.matchId + ':' + event.type + ':' + (event.team ?? '');
      const previous = capturedRoomEvents.get(key);
      const previousVersion = previous?.version ?? previous?.revision;
      const nextVersion = event.version ?? event.revision;
      if (typeof previousVersion === 'number' && typeof nextVersion === 'number' && nextVersion <= previousVersion) return;
      capturedRoomEvents.delete(key);
      capturedRoomEvents.set(key, event);
      if (capturedRoomEvents.size > 32) capturedRoomEvents.delete(capturedRoomEvents.keys().next().value!);
      window.postMessage({ type: 'umalytics:room-event', payload: event, hookVersion: 4 }, window.location.origin);
    }
    return;
  }
  // Stored snapshots are not proof of the active roster. Live console fallback
  // is only used until a typed match snapshot has arrived.
  if (source !== 'console') return;
  const syncedDraftState = selectRoomSyncedState(payload, capturedRoom, true);

  if (syncedDraftState !== null) {
    window.postMessage(
      {
        type: SYNCED_DRAFT_STATE_MESSAGE_TYPE,
        payload: syncedDraftState,
        source,
        hookVersion: 4
      },
      window.location.origin
    );
  }
}

function inspectPossibleJson(value: string, source: HookSource, capturedRoom?: string): void {
  if (
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
