import { useEffect, useRef, useSyncExternalStore } from 'react';
import { updater } from './updater';
import { createUpdateController, scheduleUpdateChecks } from './updateController';
import { installAfterRoom } from './updateState';

const controller = createUpdateController(updater);
export function useUpdater(automatic: boolean, roomActive: boolean) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const previous = useRef({ roomActive, state });
  useEffect(() => automatic ? scheduleUpdateChecks(() => { void controller.check(true); }) : undefined, [automatic]);
  useEffect(() => {
    if (state.phase === 'ready' && installAfterRoom(previous.current.state, previous.current.roomActive, roomActive)) void controller.install();
    previous.current = { roomActive, state };
  }, [roomActive, state]);
  return { state, check: () => { void controller.check(); }, install: () => { void controller.install(); }, dismiss: controller.dismiss };
}
export type UpdateControls = ReturnType<typeof useUpdater>;
