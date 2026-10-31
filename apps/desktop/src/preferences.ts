import { load } from '@tauri-apps/plugin-store';

export const pages = ['Live', 'Stamina', 'Players', 'History', 'Settings'] as const;
export const liveTabs = ['Lobby', 'Draft', 'Umas'] as const;
export type LiveTab = typeof liveTabs[number];
export type Page = typeof pages[number];
export interface Preferences { page: Page; liveTab: LiveTab; compact: boolean; compactThreshold: number; pinned: boolean; uiSize: 'Small' | 'Default' | 'Large'; staminaTarget: 90 | 95 | 99; fullSize: { width: number; height: number } }
export const preferences: Preferences = { page: 'Live', liveTab: 'Lobby', compact: false, compactThreshold: 600, pinned: false, uiSize: 'Default', staminaTarget: 90, fullSize: { width: 1280, height: 800 } };
let store: Awaited<ReturnType<typeof load>>;
let saving = Promise.resolve();

export async function loadPreferences() {
  store = await load('shell.json', { autoSave: false, defaults: {} });
  const saved = await store.get<Partial<Omit<Preferences, 'page'>> & { page?: string }>('shell');
  preferences.page = saved && pages.includes(saved.page as Page) ? saved.page as Page : 'Live';
  preferences.liveTab = liveTabs.includes(saved?.page as LiveTab) ? saved!.page as LiveTab : liveTabs.includes(saved?.liveTab as LiveTab) ? saved!.liveTab! : 'Lobby';
  const threshold = saved?.compactThreshold;
  preferences.compactThreshold = typeof threshold === 'number' && Number.isInteger(threshold) && threshold >= 440 && threshold <= 1000 ? threshold : 600;
  preferences.compact = saved?.compact === true;
  preferences.pinned = saved?.pinned === true;
  preferences.uiSize = saved?.uiSize === 'Small' || saved?.uiSize === 'Large' ? saved.uiSize : 'Default';
  preferences.staminaTarget = saved?.staminaTarget === 95 || saved?.staminaTarget === 99 ? saved.staminaTarget : 90;
  const size = saved?.fullSize;
  if (size && Number.isFinite(size.width) && size.width >= preferences.compactThreshold && size.width <= 10000 &&
      Number.isFinite(size.height) && size.height >= 400 && size.height <= 10000) preferences.fullSize = size;
}

export function phaseLiveTab(current: LiveTab, previous: string | undefined, next: string | undefined): LiveTab {
  return previous !== undefined && next !== undefined && previous !== next ? next === 'lobby' ? 'Lobby' : 'Draft' : current;
}

export function savePreferences(patch: Partial<Preferences>) {
  Object.assign(preferences, patch);
  const snapshot = structuredClone(preferences);
  saving = saving.catch(() => {}).then(async () => { await store.set('shell', snapshot); await store.save(); });
  return saving;
}
