import type { PlayerProfileSummary, PlayerStatsScope } from '@umalytics/shared';
import { mergeProfileScopes } from './profileMerge';
import { BEST_UMA_SCORE_VERSION, PROFILE_CACHE_TTL_MS, RECENT_HISTORY_VERSION } from './profileConstants';

/** The one freshness rule for the lobby and lookups: a complete, current-format
 * profile whose stats for `scope` were fetched within the cache TTL. The scope
 * is passed explicitly, never read from the live setting. */
export function isFreshProfile(profile: PlayerProfileSummary | undefined, scope: PlayerStatsScope, now: number): boolean {
  if (profile === undefined || profile.error !== undefined || profile.isPartial === true) return false;
  // Older profiles have no per-scope timestamps; fetchedAt only covers the scope they were shown in.
  const scopeFetchedAt = profile.scopeFetchedAt !== undefined
    ? profile.scopeFetchedAt[scope]
    : profile.statsScope === scope ? profile.fetchedAt : undefined;
  return (
    scopeFetchedAt !== undefined && now - scopeFetchedAt < PROFILE_CACHE_TTL_MS &&
    hasCurrentStatsShape(profile) &&
    profile.bestUmaScoreVersion === BEST_UMA_SCORE_VERSION &&
    profile.recentHistoryVersion === RECENT_HISTORY_VERSION &&
    profile.currentSeasonStats?.recentHistoryVersion === RECENT_HISTORY_VERSION &&
    profile.allTimeStats?.recentHistoryVersion === RECENT_HISTORY_VERSION
  );
}

export function hasCurrentStatsShape(profile: PlayerProfileSummary): boolean {
  return (
    profile.currentSeasonStats !== undefined &&
    profile.allTimeStats !== undefined &&
    Array.isArray(profile.allTimeStats.allUmas)
  );
}

const MAX_PROFILE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_PROFILES = 100;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;

/** A bounded cache across lobbies. fetchedAt is never extended by reading it. */
export function mergeProfileCache(
  existing: Record<string, PlayerProfileSummary>,
  incoming: Record<string, PlayerProfileSummary>,
  now: number
): Record<string, PlayerProfileSummary> {
  const merged = { ...existing };
  for (const [id, profile] of Object.entries(incoming)) {
    if (profile.isPartial === true || !Number.isFinite(profile.fetchedAt)) continue;
    const previous = merged[id];
    if (previous === undefined || profile.fetchedAt >= previous.fetchedAt) merged[id] = mergeProfileScopes(previous, profile);
  }
  let bytes = 0;
  return Object.fromEntries(Object.entries(merged)
    .filter(([, profile]) => Number.isFinite(profile.fetchedAt) && now - profile.fetchedAt < MAX_PROFILE_AGE_MS)
    .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
    .slice(0, MAX_CACHED_PROFILES)
    .filter(([id, profile]) => {
      // Conservative UTF-16 estimate avoids exceeding storage.local's quota.
      const size = (JSON.stringify(profile).length + id.length + 8) * 2;
      if (bytes + size > MAX_CACHE_BYTES) return false;
      bytes += size;
      return true;
    }));
}
