const SYNCED_DRAFT_STATE_MESSAGE_TYPE = 'umalytics:synced-draft-state';
const SYNC_EFFECT_LOG_PREFIX = '[SYNC EFFECT] Starting sync';
const INSTALL_FLAG = '__umalyticsPageHookInstalled_0_3_0';

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

  if (payload instanceof Blob) {
    void payload.text().then(inspectPossibleJson).catch(() => {
      // Ignore undecodable socket frames.
    });
    return;
  }

  if (payload instanceof ArrayBuffer) {
    inspectPossibleJson(new TextDecoder().decode(payload));
    return;
  }

  const syncedDraftState = findSyncedDraftStateInContainer(payload);

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
  if (
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
      inspectPossiblePayload(JSON.parse(candidate));
      return;
    } catch {
      // Try the next candidate; realtime protocols can prefix JSON with frame codes.
    }
  }
}

function getJsonCandidates(value: string): string[] {
  const candidates = [value];

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if ((character === '{' || character === '[') && index > 0) {
      candidates.push(value.slice(index));
    }
  }

  return candidates;
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

  if (Array.isArray(value.participants) && hasMultiplayerDraftStateHint(value)) {
    return {
      syncedDraftState_multiplayer: value,
      ...(typeof value.phase === 'string' ? { syncedDraftState_phase: value.phase } : {}),
      ...(typeof value.currentTeam === 'string' ? { syncedDraftState_currentTeam: value.currentTeam } : {})
    };
  }

  if (Array.isArray(value.players) && hasMultiplayerRoomHint(value)) {
    return {
      syncedDraftState_multiplayer: value,
      ...(typeof value.phase === 'string' ? { syncedDraftState_phase: value.phase } : {}),
      ...(typeof value.currentTeam === 'string' ? { syncedDraftState_currentTeam: value.currentTeam } : {})
    };
  }

  if (Array.isArray(value.roomPlayers) && hasMultiplayerRoomHint(value)) {
    return {
      syncedDraftState_multiplayer: value,
      ...(typeof value.phase === 'string' ? { syncedDraftState_phase: value.phase } : {}),
      ...(typeof value.currentTeam === 'string' ? { syncedDraftState_currentTeam: value.currentTeam } : {})
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

function hasMultiplayerRoomHint(value: JsonRecord): boolean {
  return (
    hasMultiplayerDraftStateHint(value) ||
    typeof value.roomCode === 'string' ||
    typeof value.code === 'string' ||
    typeof value.connectionType === 'string' ||
    typeof value.localActorUserId === 'string' ||
    typeof value.localTeam === 'string'
  );
}

function hasMultiplayerDraftStateHint(value: JsonRecord): boolean {
  return (
    typeof value.roomId === 'string' ||
    typeof value.matchId === 'string' ||
    typeof value.team1Name === 'string' ||
    typeof value.team2Name === 'string' ||
    isRecord(value.team1) ||
    isRecord(value.team2)
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}
