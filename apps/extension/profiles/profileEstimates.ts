import type { PlayerProfileSummary, PlayerStatsScope } from '@umalytics/shared';

export async function applyPrivateEstimates(
  profiles: Record<string, PlayerProfileSummary>,
  _scope: PlayerStatsScope,
  _signal: AbortSignal,
  _onUpdate: (profile: PlayerProfileSummary) => void | Promise<void>
): Promise<Record<string, PlayerProfileSummary>> {
  return profiles;
}
