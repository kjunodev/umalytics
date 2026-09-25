import { browser } from 'wxt/browser';

export const PLAYERS_RECENT_STORAGE_KEY = 'playersRecentViewed';

export interface RecentPlayerEntry {
  discordId: string;
  displayName: string;
}

function isRecentPlayerEntry(value: unknown): value is RecentPlayerEntry {
  const record = value as Partial<RecentPlayerEntry> | null;
  return typeof record === 'object' && record !== null &&
    typeof record.discordId === 'string' && typeof record.displayName === 'string';
}

// Storage is a convenience for recent chips, never load-bearing: any failure
// (unavailable API, quota, corrupt value) falls back to an empty list.
export async function getRecentPlayers(): Promise<RecentPlayerEntry[]> {
  try {
    if (typeof browser === 'undefined' || browser.storage?.local === undefined) return [];
    const values = await browser.storage.local.get(PLAYERS_RECENT_STORAGE_KEY);
    const stored = values[PLAYERS_RECENT_STORAGE_KEY];
    return Array.isArray(stored) ? stored.filter(isRecentPlayerEntry) : [];
  } catch {
    return [];
  }
}

export async function setRecentPlayers(recent: RecentPlayerEntry[]): Promise<void> {
  try {
    if (typeof browser === 'undefined' || browser.storage?.local === undefined) return;
    await browser.storage.local.set({ [PLAYERS_RECENT_STORAGE_KEY]: recent });
  } catch {
    // Recent chips are a convenience; storage failures should not block the view.
  }
}
