import type { PlayerProfileSummary, PlayerStatsScope } from '@umalytics/shared';

export function missingUmaHistoryLabel(profile: PlayerProfileSummary | undefined, scope: PlayerStatsScope): string {
  if (profile === undefined) return 'Stats not loaded yet';
  if (profile.scopeFetchedAt && profile.scopeFetchedAt[scope] === undefined) return 'Stats not loaded for this scope';
  if (profile.statsPrivate && !profile.historyDerived) return 'Stats are private';
  if (profile.error) return 'Stats unavailable';
  if (profile.historyDerived) return 'No games in available history sample';
  return 'No recorded games';
}
