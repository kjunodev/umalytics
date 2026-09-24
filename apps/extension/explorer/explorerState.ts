import type { PlayerProfileSummary } from '@umalytics/shared';
import { mergeProfileScopes } from '../profiles/profileMerge';

/** Preserve a usable result on retry failures, but always apply confirmed privacy changes. */
export function mergeExplorerProfiles(previous: Record<string, PlayerProfileSummary>, incoming: Record<string, PlayerProfileSummary>): Record<string, PlayerProfileSummary> {
  const result = { ...previous };
  for (const [id, profile] of Object.entries(incoming)) {
    const old = previous[id];
    const oldHasStats = old !== undefined && typeof old.matches === 'number';
    const incomingHasStats = typeof profile.matches === 'number';
    if (oldHasStats && !incomingHasStats && profile.statsPrivate !== true && profile.error) {
      result[id] = { ...old, error: profile.error, isPartial: false };
    } else if (oldHasStats && !incomingHasStats && !old.error && !old.isPartial && profile.isPartial && profile.statsPrivate !== true) {
      result[id] = old;
    } else result[id] = mergeProfileScopes(old, profile);
  }
  return result;
}
