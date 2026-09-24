import { browser } from 'wxt/browser';
import type { DraftSnapshot } from '@umalytics/shared';

export const LATEST_DRAFT_SNAPSHOT_STORAGE_KEY = 'latestDraftSnapshot';

type LatestDraftSnapshotStorage = {
  [LATEST_DRAFT_SNAPSHOT_STORAGE_KEY]?: DraftSnapshot;
};

export async function getLatestDraftSnapshot(): Promise<DraftSnapshot | undefined> {
  const values = (await browser.storage.local.get(
    LATEST_DRAFT_SNAPSHOT_STORAGE_KEY
  )) as LatestDraftSnapshotStorage;

  return values[LATEST_DRAFT_SNAPSHOT_STORAGE_KEY];
}

export async function setLatestDraftSnapshot(snapshot: DraftSnapshot): Promise<void> {
  await browser.storage.local.set({
    [LATEST_DRAFT_SNAPSHOT_STORAGE_KEY]: snapshot
  } satisfies LatestDraftSnapshotStorage);
}

export async function clearLatestDraftSnapshot(): Promise<void> {
  await browser.storage.local.remove(LATEST_DRAFT_SNAPSHOT_STORAGE_KEY);
}
