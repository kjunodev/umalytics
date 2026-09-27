import type { PlayerProfileSummary, PlayerProfileStatsSummary, PlayerStatsScope } from '@umalytics/shared';

/** Merge only data belonging to the same player and season. An empty successful
 * history response replaces old history; an unfinished request does not. */
export function mergeProfileScopes(previous: PlayerProfileSummary | undefined, next: PlayerProfileSummary): PlayerProfileSummary {
  const historyDenied = next.allTimeStats?.recentHistoryStatus === 'private' || next.currentSeasonStats?.recentHistoryStatus === 'private';
  if (!previous || previous.discordId !== next.discordId || historyDenied || next.statsPrivate) return next;
  const seasonPending = next.activeSeasonId === undefined && next.isPartial === true;
  const sameSeason = seasonPending || previous.activeSeasonId === next.activeSeasonId;
  function mergeScope(scope: PlayerStatsScope): PlayerProfileStatsSummary | undefined {
    const key = scope === 'allTime' ? 'allTimeStats' : 'currentSeasonStats';
    const old = scope === 'currentSeason' && !sameSeason ? undefined : previous?.[key];
    const incoming = next[key];
    if (next.scopeFetchedAt && next.scopeFetchedAt[scope] === undefined) return old ?? incoming;
    if (!old || !incoming || incoming.recentHistoryStatus === 'private') return incoming;
    const pending = next.isPartial || incoming.recentHistoryStatus === 'loading' || incoming.recentHistoryStatus === 'unavailable' || incoming.recentMatches === undefined;
    if (pending && (old.recentMatches?.length ?? 0) > 0 && (incoming.recentMatches?.length ?? 0) === 0) {
      return { ...incoming, recentMatches: old.recentMatches, recentHistoryStatus: old.recentHistoryStatus };
    }
    return incoming;
  }
  const currentSeasonStats = mergeScope('currentSeason');
  const allTimeStats = mergeScope('allTime');
  const timestamps = { ...previous.scopeFetchedAt, ...next.scopeFetchedAt };
  if (!sameSeason && !next.scopeFetchedAt?.currentSeason) delete timestamps.currentSeason;
  const selected = next.statsScope === 'allTime' ? allTimeStats : currentSeasonStats;
  return { ...next, currentSeasonStats, allTimeStats,
    ...(seasonPending ? { activeSeasonId: previous.activeSeasonId } : {}),
    ...(next.scopeFetchedAt ? { scopeFetchedAt: timestamps } : {}),
    ...(selected ? { recentMatches: selected.recentMatches,
      recentHistoryStatus: selected.recentHistoryStatus, historyTotal: selected.historyTotal,
      historySummary: selected.historySummary } : {}) };
}

export function recentHistoryEmptyMessage(profile: PlayerProfileSummary | undefined): string | undefined {
  if ((profile?.recentMatches?.length ?? 0) > 0) return undefined;
  if (profile?.recentHistoryStatus === 'private') return 'Match history is private.';
  if (profile?.recentHistoryStatus === 'loaded') return 'No recent match history found.';
  if (profile?.recentHistoryStatus === 'loading') return 'Loading recent match history.';
  if (profile?.recentHistoryStatus === 'unavailable') return 'Recent match history is unavailable for this scope.';
  if (profile?.statsPrivate) return 'Match history is private.';
  if (!profile || profile.isPartial) return 'Loading recent match history.';
  return 'Recent match history is unavailable for this scope.';
}
