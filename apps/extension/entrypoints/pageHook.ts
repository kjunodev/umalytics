const SYNCED_DRAFT_STATE_MESSAGE_TYPE = 'umalytics:synced-draft-state';
const SYNC_EFFECT_LOG_PREFIX = '[SYNC EFFECT] Starting sync';
const INSTALL_FLAG = '__umalyticsPageHookInstalled';

type JsonRecord = Record<string, unknown>;
type UmaLyticsWindow = Window & {
  [INSTALL_FLAG]?: boolean;
};

export default defineUnlistedScript(() => {
  const pageWindow = window as UmaLyticsWindow;

  if (pageWindow[INSTALL_FLAG] === true) {
    return;
  }

  pageWindow[INSTALL_FLAG] = true;
  installSyncConsoleHook();
  installWebSocketHook();
  scanBrowserStorageOnce();
});

function installSyncConsoleHook(): void {
  const methods = ['debug', 'log', 'info'] as const;

  for (const method of methods) {
    const originalMethod = window.console[method].bind(window.console);

    window.console[method] = (...args: unknown[]) => {
      if (args[0] === SYNC_EFFECT_LOG_PREFIX) {
        for (const arg of args.slice(1)) {
          inspectPossiblePayload(arg);
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
        inspectPossiblePayload(event.data);
      });

      return socket;
    }
  });

  window.WebSocket.prototype = OriginalWebSocket.prototype;
}

function scanBrowserStorageOnce(): void {
  scanStorageArea(window.localStorage);
  scanStorageArea(window.sessionStorage);
}

function scanStorageArea(storage: Storage): void {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (key === null) {
      continue;
    }

    const value = storage.getItem(key);

    if (value !== null) {
      inspectPossibleJson(value);
    }
  }
}

function inspectPossiblePayload(payload: unknown): void {
  if (typeof payload === 'string') {
    inspectPossibleJson(payload);
    return;
  }

  const syncedDraftState = findSyncedDraftState(payload);

  if (syncedDraftState !== null) {
    window.postMessage(
      {
        type: SYNCED_DRAFT_STATE_MESSAGE_TYPE,
        payload: syncedDraftState
      },
      window.location.origin
    );
  }
}

function inspectPossibleJson(value: string): void {
  if (!value.includes('rankedQueueRoster') && !value.includes('syncedDraftState_multiplayer')) {
    return;
  }

  try {
    inspectPossiblePayload(JSON.parse(value));
  } catch {
    // Some realtime protocols wrap JSON in non-JSON frames; those can be decoded later once observed.
  }
}

function findSyncedDraftState(value: unknown): JsonRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  if (isRecord(value.syncedDraftState_multiplayer)) {
    return value;
  }

  if (Array.isArray(value.rankedQueueRoster)) {
    return {
      syncedDraftState_multiplayer: value
    };
  }

  for (const child of Object.values(value)) {
    if (!isRecord(child) && !Array.isArray(child)) {
      continue;
    }

    const nestedState = findSyncedDraftStateInContainer(child);

    if (nestedState !== null) {
      return nestedState;
    }
  }

  return null;
}

function findSyncedDraftStateInContainer(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedState = findSyncedDraftState(item);

      if (nestedState !== null) {
        return nestedState;
      }
    }

    return null;
  }

  return findSyncedDraftState(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}
