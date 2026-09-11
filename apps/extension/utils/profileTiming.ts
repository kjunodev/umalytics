import type { PlayerStatsScope } from '@umalytics/shared';
import type { PlayerProfileSummariesSnapshot } from './profileStorage';
import { MANUAL_PROFILE_REFRESH_COOLDOWN_MS } from './profileConstants';

/** Room publications are not stats checks. Use the selected scope's real timestamp. */
export function latestStatsCheckAt(snapshot: PlayerProfileSummariesSnapshot | undefined, scope: PlayerStatsScope): number | undefined {
  const times = Object.values(snapshot?.profiles ?? {}).map(profile =>
    profile.scopeFetchedAt === undefined ? profile.fetchedAt : profile.scopeFetchedAt[scope]
  ).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return times.length ? Math.max(...times) : undefined;
}

export function getRefreshCooldownMs(manualRefreshAt: number | undefined, now: number): number {
  if (manualRefreshAt === undefined || !Number.isFinite(manualRefreshAt) || manualRefreshAt > now) return 0;
  return Math.max(manualRefreshAt + MANUAL_PROFILE_REFRESH_COOLDOWN_MS - now, 0);
}
