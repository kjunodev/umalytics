import { browser } from 'wxt/browser';
import type { PlayerProfileSummary } from '@umalytics/shared';

export const PLAYER_PROFILE_SUMMARIES_STORAGE_KEY = 'playerProfileSummaries';

export interface PlayerProfileSummariesSnapshot {
  matchCode?: string;
  profiles: Record<string, PlayerProfileSummary>;
  loadingDiscordIds: string[];
  updatedAt: number;
}

type PlayerProfileSummariesStorage = {
  [PLAYER_PROFILE_SUMMARIES_STORAGE_KEY]?: PlayerProfileSummariesSnapshot;
};

export async function getPlayerProfileSummaries(): Promise<
  PlayerProfileSummariesSnapshot | undefined
> {
  const values = (await browser.storage.local.get(
    PLAYER_PROFILE_SUMMARIES_STORAGE_KEY
  )) as PlayerProfileSummariesStorage;

  return values[PLAYER_PROFILE_SUMMARIES_STORAGE_KEY];
}

export async function setPlayerProfileSummaries(
  snapshot: PlayerProfileSummariesSnapshot
): Promise<void> {
  await browser.storage.local.set({
    [PLAYER_PROFILE_SUMMARIES_STORAGE_KEY]: snapshot
  } satisfies PlayerProfileSummariesStorage);
}
