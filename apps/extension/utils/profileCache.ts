import type { PlayerProfileSummary } from '@umalytics/shared';

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
    if (previous === undefined || profile.fetchedAt >= previous.fetchedAt) merged[id] = profile;
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
