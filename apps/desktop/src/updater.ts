import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// Native operations stay here; scheduling and UI decisions are testable separately.
export interface DesktopUpdate { version: string; body?: string; download(): Promise<void>; install(): Promise<void>; close(): Promise<void> }
export const updater = {
  check: (): Promise<DesktopUpdate | null> => check({ timeout: 30_000 }) as Promise<Update | null>,
  restart: () => relaunch(),
};
