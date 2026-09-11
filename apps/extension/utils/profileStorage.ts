import { mergeProfileCache } from './profileCache';
import { browser } from 'wxt/browser';
import type { PlayerProfileSummary } from '@umalytics/shared';

export const PLAYER_PROFILE_SUMMARIES_STORAGE_KEY = 'playerProfileSummaries';
declare const __UMALYTICS_PRIVATE_PROFILE_DATA__: boolean;
const BUILD_MODE = __UMALYTICS_PRIVATE_PROFILE_DATA__ ? 'private' : 'public';
const PROFILE_ARCHIVE_KEY = 'profileArchiveV1-' + BUILD_MODE;
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

export type PlayerProfileLoadStatus = 'queued' | 'loading' | 'loaded' | 'private' | 'timeout' | 'error';

export interface PlayerProfileLoadState {
  discordId: string;
  status: PlayerProfileLoadStatus;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
  error?: string;
  stage?: string;
  retryAt?: number;
}

export interface PlayerProfileSummariesSnapshot {
  buildMode?: 'private' | 'public';
  matchCode?: string;
  runId?: number;
  startedAt?: number;
  manualRefreshAt?: number;
  profiles: Record<string, PlayerProfileSummary>;
  profileStates?: Record<string, PlayerProfileLoadState>;
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

  return filterSnapshotForBuild(values[PLAYER_PROFILE_SUMMARIES_STORAGE_KEY]);
}

export async function setPlayerProfileSummaries(
  snapshot: PlayerProfileSummariesSnapshot
): Promise<void> {
  await browser.storage.local.set({
    [PLAYER_PROFILE_SUMMARIES_STORAGE_KEY]: { ...snapshot, buildMode: BUILD_MODE }
  } satisfies PlayerProfileSummariesStorage);
}

export function filterSnapshotForBuild(snapshot: PlayerProfileSummariesSnapshot | undefined): PlayerProfileSummariesSnapshot | undefined {
  if (snapshot === undefined) return undefined;
  if (snapshot.buildMode !== undefined && snapshot.buildMode !== BUILD_MODE) return undefined;
  // Older snapshots did not record their build. Never expose private history after
  // someone replaces a private package with a public package in the same folder.
  if (!__UMALYTICS_PRIVATE_PROFILE_DATA__ && snapshot.buildMode === undefined) return {
    ...snapshot, profiles: Object.fromEntries(Object.entries(snapshot.profiles).filter(([, profile]) => !profile.statsPrivate))
  };
  return snapshot;
}
