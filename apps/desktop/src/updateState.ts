export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';
export interface UpdateState {
  phase: UpdatePhase;
  version?: string;
  notes?: string;
  lastChecked?: number;
  error?: string;
  dismissedVersion?: string;
}
export type UpdateEvent =
  | { type: 'check' }
  | { type: 'current'; at: number }
  | { type: 'checked'; at: number; error?: string }
  | { type: 'found'; version: string; notes?: string; at: number }
  | { type: 'downloaded' }
  | { type: 'install' }
  | { type: 'failed'; error: string; automaticCheck?: boolean; at?: number }
  | { type: 'dismiss' };

export function updateState(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'check': return { ...state, phase: 'checking', error: undefined };
    case 'current': return { ...state, phase: 'idle', version: undefined, notes: undefined, lastChecked: event.at, error: undefined };
    case 'checked': return { ...state, lastChecked: event.at, error: event.error };
    case 'found': return { ...state, phase: 'downloading', version: event.version, notes: event.notes, lastChecked: event.at, error: undefined };
    case 'downloaded': return state.phase === 'downloading' ? { ...state, phase: 'ready' } : state;
    case 'install': return state.phase === 'ready' ? { ...state, phase: 'installing', error: undefined } : state;
    case 'failed': return { ...state, phase: event.automaticCheck ? 'idle' : 'error', error: event.error, lastChecked: event.at ?? state.lastChecked };
    case 'dismiss': return { ...state, dismissedVersion: state.version ?? 'check-error' };
  }
}

export function updateBanner(state: UpdateState, roomActive: boolean): 'hidden' | 'downloading' | 'ready' | 'deferred' | 'error' | 'installing' {
  if (state.dismissedVersion === (state.version ?? 'check-error')) return 'hidden';
  if (state.phase === 'ready') return roomActive ? 'deferred' : 'ready';
  return ['downloading', 'error', 'installing'].includes(state.phase) ? state.phase as 'downloading' | 'error' | 'installing' : 'hidden';
}

export function roomIsActive(feedState: string | undefined, roomCode: string | undefined): boolean {
  return feedState === 'connected' && !!roomCode;
}

export function installAfterRoom(state: UpdateState, wasActive: boolean, active: boolean): boolean {
  return state.phase === 'ready' && wasActive && !active;
}
