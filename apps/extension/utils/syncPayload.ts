type SyncRecord = Record<string, unknown>;

export function readPayloadRoomCode(value: unknown): string | undefined {
  if (!isSyncRecord(value)) return undefined;
  for (const key of ['roomCode', 'matchCode', 'code', 'roomId', 'matchId']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && /^[A-Z0-9]{6}$/i.test(candidate)) return candidate.toUpperCase();
  }
  return undefined;
}

/** Keep room identity when unwrapping socket envelopes. Unscoped socket/storage
 * payloads must never inherit the currently visible lobby's identity. */
export function selectRoomSyncedState(
  value: unknown,
  expectedRoom: string | undefined,
  allowPageConsoleContext = false
): SyncRecord | null {
  const visited = new WeakSet<object>();
  let remainingNodes = 500;
  const expected = expectedRoom?.toUpperCase();
  function visit(node: unknown, inheritedRoom?: string, depth = 0): SyncRecord | null {
    if (node === null || typeof node !== 'object' || depth > 12 || --remainingNodes < 0 || visited.has(node)) return null;
    visited.add(node);
    if (Array.isArray(node)) {
      for (const child of node) { const result = visit(child, inheritedRoom, depth + 1); if (result !== null) return result; }
      return null;
    }
    const record = node as SyncRecord;
    const envelopeRoom = readPayloadRoomCode(record) ?? inheritedRoom;
    const multiplayer = isSyncRecord(record.syncedDraftState_multiplayer) ? record.syncedDraftState_multiplayer : record;
    const owner = readPayloadRoomCode(multiplayer) ?? envelopeRoom ?? (allowPageConsoleContext ? expected : undefined);
    const hasRoster = ['rankedQueueRoster', 'participants', 'players', 'roomPlayers'].some(key => Array.isArray(multiplayer[key]));
    const isWrapped = multiplayer !== record;
    if ((isWrapped || hasRoster) && owner !== undefined && (expected === undefined || owner === expected)) {
      return {
        ...(isWrapped ? record : {}),
        syncedDraftState_multiplayer: { ...multiplayer, roomCode: owner },
        ...(!isWrapped && typeof record.phase === 'string' ? { syncedDraftState_phase: record.phase } : {}),
        ...(!isWrapped && typeof record.currentTeam === 'string' ? { syncedDraftState_currentTeam: record.currentTeam } : {})
      };
    }
    // Explicit foreign room envelopes cannot lend identity to unscoped children.
    if (envelopeRoom !== undefined && expected !== undefined && envelopeRoom !== expected) return null;
    for (const child of Object.values(record)) {
      const result = visit(child, envelopeRoom, depth + 1);
      if (result !== null) return result;
    }
    return null;
  }
  return visit(value);
}

function isSyncRecord(value: unknown): value is SyncRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
