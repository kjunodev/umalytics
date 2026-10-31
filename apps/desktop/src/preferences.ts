import { load } from '@tauri-apps/plugin-store';

export const pages = ['Lobby', 'Draft', 'Stamina', 'Players', 'History', 'Umas', 'Settings'] as const;
export type Page = typeof pages[number];
export interface Preferences { page: Page; compact: boolean; compactThreshold: number; pinned: boolean; fullSize: { width: number; height: number } }
export const preferences: Preferences = { page: 'Lobby', compact: false, compactThreshold: 600, pinned: false, fullSize: { width: 1280, height: 800 } };
let store: Awaited<ReturnType<typeof load>>;
let saving = Promise.resolve();

export async function loadPreferences() {
  store = await load('shell.json', { autoSave: false, defaults: {} });
  const saved = await store.get<Partial<Preferences>>('shell');
  preferences.page = saved && pages.includes(saved.page as Page) ? saved.page! : 'Lobby';
  const threshold = saved?.compactThreshold;
  preferences.compactThreshold = typeof threshold === 'number' && Number.isInteger(threshold) && threshold >= 440 && threshold <= 1000 ? threshold : 600;
  preferences.compact = saved?.compact === true;
  preferences.pinned = saved?.pinned === true;
  const size = saved?.fullSize;
  if (size && Number.isFinite(size.width) && size.width >= preferences.compactThreshold && size.width <= 10000 &&
      Number.isFinite(size.height) && size.height >= 400 && size.height <= 10000) preferences.fullSize = size;
}

export function savePreferences(patch: Partial<Preferences>) {
  Object.assign(preferences, patch);
  const snapshot = structuredClone(preferences);
  saving = saving.catch(() => {}).then(async () => { await store.set('shell', snapshot); await store.save(); });
  return saving;
}
