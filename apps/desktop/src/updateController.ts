import { updateState, type UpdateEvent, type UpdateState } from './updateState';
import type { DesktopUpdate } from './updater';

export function createUpdateController(native: { check(): Promise<DesktopUpdate | null>; restart(): Promise<void> }, now = Date.now) {
  let state: UpdateState = { phase: 'idle' };
  let pending: DesktopUpdate | null = null;
  let checking = false;
  const listeners = new Set<() => void>();
  const send = (event: UpdateEvent) => { state = updateState(state, event); listeners.forEach(listener => listener()); };
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dismiss: () => send({ type: 'dismiss' }),
    async check(automatic = false) {
      if (checking || ['checking', 'downloading', 'installing'].includes(state.phase)) return;
      checking = true;
      const hadReadyUpdate = state.phase === 'ready';
      if (!hadReadyUpdate) send({ type: 'check' });
      let found = false;
      try {
        const candidate = await native.check();
        if (state.phase === 'installing') { await candidate?.close(); return; }
        if (hadReadyUpdate && (!candidate || candidate.version === pending?.version)) {
          await candidate?.close(); send({ type: 'checked', at: now() }); return;
        }
        await pending?.close(); pending = candidate;
        if (!pending) { send({ type: 'current', at: now() }); return; }
        found = true;
        send({ type: 'found', version: pending.version, notes: pending.body, at: now() });
        await pending.download();
        send({ type: 'downloaded' });
      } catch (error) {
        if (hadReadyUpdate && !found) send({ type: 'checked', error: message(error), at: now() });
        else send({ type: 'failed', error: message(error), automaticCheck: automatic && !found, at: now() });
      } finally { checking = false; }
    },
    async install() {
      if (state.phase !== 'ready' || !pending) return;
      send({ type: 'install' });
      try {
        await pending.install();
        await native.restart();
      } catch (error) { send({ type: 'failed', error: message(error) }); }
    },
  };
}

export function scheduleUpdateChecks(check: () => void, clock = globalThis): () => void {
  const first = clock.setTimeout(check, 10_000);
  const recurring = clock.setInterval(check, 6 * 60 * 60 * 1000);
  return () => { clock.clearTimeout(first); clock.clearInterval(recurring); };
}
