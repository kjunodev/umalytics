import { useEffect, useSyncExternalStore } from 'react';
import { updater } from './updater';
import { createUpdateController, scheduleUpdateChecks } from './updateController';

const controller = createUpdateController(updater);
export function useUpdater(automatic: boolean) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => automatic ? scheduleUpdateChecks(() => { void controller.check(true); }) : undefined, [automatic]);
  return { state, check: () => { void controller.check(); }, install: () => { void controller.install(); }, dismiss: controller.dismiss };
}
export type UpdateControls = ReturnType<typeof useUpdater>;
