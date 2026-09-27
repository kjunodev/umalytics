import { browser } from 'wxt/browser';
import type { EsportsTeamIconMap } from '@umalytics/shared';

export const TEAM_ICON_MAP_STORAGE_KEY = 'esportsTeamIconMapV1';
export const TEAM_ICON_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface TeamIconMapSnapshot {
  map: EsportsTeamIconMap;
  fetchedAt: number;
}

function isTeamIconMapSnapshot(value: unknown): value is TeamIconMapSnapshot {
  const record = value as Partial<TeamIconMapSnapshot> | null;
  return typeof record === 'object' && record !== null &&
    typeof record.fetchedAt === 'number' && typeof record.map === 'object' && record.map !== null;
}

// Never load-bearing: a lobby with no team icons is a normal lobby, so any
// failure here (unavailable API, quota, corrupt value) falls back to no cache.
export async function getTeamIconSnapshot(): Promise<TeamIconMapSnapshot | undefined> {
  try {
    if (typeof browser === 'undefined' || browser.storage?.local === undefined) return undefined;
    const values = await browser.storage.local.get(TEAM_ICON_MAP_STORAGE_KEY);
    const stored = values[TEAM_ICON_MAP_STORAGE_KEY];
    return isTeamIconMapSnapshot(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

export async function setTeamIconSnapshot(snapshot: TeamIconMapSnapshot): Promise<void> {
  try {
    if (typeof browser === 'undefined' || browser.storage?.local === undefined) return;
    await browser.storage.local.set({ [TEAM_ICON_MAP_STORAGE_KEY]: snapshot });
  } catch {
    // Team icons are a cosmetic layer; storage failures should not block the lobby.
  }
}

export function isTeamIconSnapshotFresh(snapshot: TeamIconMapSnapshot | undefined, now: number): boolean {
  return snapshot !== undefined && now - snapshot.fetchedAt < TEAM_ICON_CACHE_TTL_MS;
}
