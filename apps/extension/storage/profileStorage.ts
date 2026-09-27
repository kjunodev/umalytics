import { mergeProfileCache } from '../profiles/profileCache';
import { browser } from 'wxt/browser';
import type { PlayerProfileSummary } from '@umalytics/shared';
import type { PlayerProfileSummariesSnapshot } from '../profiles/profileTypes';

export const PLAYER_PROFILE_SUMMARIES_STORAGE_KEY = 'playerProfileSummariesV2';
const PROFILE_ARCHIVE_KEY = 'profileArchiveV2';
let profileArchive: Record<string, PlayerProfileSummary> | undefined;
let archiveLoad: Promise<Record<string, PlayerProfileSummary>> | undefined;
let archiveWrites = Promise.resolve();

export async function getCachedPlayerProfiles(): Promise<Record<string, PlayerProfileSummary>> {
  if (profileArchive !== undefined) return profileArchive;
  return archiveLoad ??= browser.storage.local.get(PROFILE_ARCHIVE_KEY).then(values => {
    profileArchive = mergeProfileCache({}, (values[PROFILE_ARCHIVE_KEY] ?? {}) as Record<string, PlayerProfileSummary>, Date.now());
    return profileArchive;
  });
}

export function rememberCachedPlayerProfiles(profiles: Record<string, PlayerProfileSummary>): Promise<void> {
  const write = archiveWrites.then(async () => {
    const old = await getCachedPlayerProfiles();
    const next = mergeProfileCache(old, profiles, Date.now());
    if (JSON.stringify(old) === JSON.stringify(next)) return;
    await browser.storage.local.set({ [PROFILE_ARCHIVE_KEY]: next });
    profileArchive = next;
  });
  archiveWrites = write.catch(() => {});
  return write;
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
