import { browser } from 'wxt/browser';
import type { PrematchRoster } from '@umalytics/shared';

export const LATEST_PREMATCH_ROSTER_STORAGE_KEY = 'latestPrematchRoster';

type LatestPrematchRosterStorage = {
  [LATEST_PREMATCH_ROSTER_STORAGE_KEY]?: PrematchRoster;
};

export async function getLatestPrematchRoster(): Promise<PrematchRoster | undefined> {
  const values = (await browser.storage.local.get(
    LATEST_PREMATCH_ROSTER_STORAGE_KEY
  )) as LatestPrematchRosterStorage;

  return values[LATEST_PREMATCH_ROSTER_STORAGE_KEY];
}

export async function setLatestPrematchRoster(roster: PrematchRoster): Promise<void> {
  await browser.storage.local.set({
    [LATEST_PREMATCH_ROSTER_STORAGE_KEY]: roster
  } satisfies LatestPrematchRosterStorage);
}

export async function clearLatestPrematchRoster(): Promise<void> {
  await browser.storage.local.remove(LATEST_PREMATCH_ROSTER_STORAGE_KEY);
}
