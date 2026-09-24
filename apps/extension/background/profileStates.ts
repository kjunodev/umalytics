import type { PlayerProfileSummary, PrematchPlayer } from '@umalytics/shared';
import { mergeProfileScopes } from '../profiles/profileMerge';
import type { ApiCooldown } from '../profiles/playerProfileApi';
import type { PlayerProfileLoadState, PlayerProfileLoadStatus } from '../storage/profileStorage';

const MAX_AUTOMATIC_RETRIES = 2;
export interface ProfileRecovery {
  key: string;
  attempt: number;
  retryAt: number;
  cooldown: ApiCooldown;
  exhausted?: boolean;
}

function markProfilesForRecovery(states: Record<string, PlayerProfileLoadState>, ids: string[], recovery: ProfileRecovery): void {
  for (const id of ids) {
    if (states[id] === undefined) continue;
    states[id] = { ...states[id], status: 'queued', retryAt: recovery.retryAt,
      stage: `API paused after HTTP ${recovery.cooldown.status}; automatic retry ${recovery.attempt}/${MAX_AUTOMATIC_RETRIES}`,
      error: states[id].error ?? `HTTP ${recovery.cooldown.status}: ${recovery.cooldown.path}`, updatedAt: Date.now() };
  }
}

function retainUsableProfile(previous: PlayerProfileSummary | undefined, next: PlayerProfileSummary): PlayerProfileSummary {
  // Keep useful cached data on transport failure, but never override a confirmed privacy response.
  if (next.error !== undefined && next.statsPrivate !== true && previous !== undefined &&
      hasUsableProfileStats(previous) && !hasUsableProfileStats(next)) {
    return { ...previous, error: next.error };
  }
  return mergeProfileScopes(previous, next);
}


function buildProfileLoadStates(
  profiles: Record<string, PlayerProfileSummary>,
  loadingPlayers: PrematchPlayer[],
  now: number
): Record<string, PlayerProfileLoadState> {
  const profileStates = Object.fromEntries(
    Object.entries(profiles).map(([discordId, profile]) => [
      discordId,
      buildCompletedProfileState(discordId, profile, profile.fetchedAt)
    ] as const)
  );

  for (const player of loadingPlayers) {
    profileStates[player.discordId] = {
      discordId: player.discordId,
      status: 'queued',
      updatedAt: now
    };
  }

  return profileStates;
}

function buildCompletedProfileState(
  discordId: string,
  profile: PlayerProfileSummary,
  finishedAt: number
): PlayerProfileLoadState {
  return {
    discordId,
    status: getProfileLoadStatus(profile),
    startedAt: profile.fetchedAt,
    finishedAt,
    updatedAt: finishedAt,
    error: profile.error
  };
}

function getProfileLoadStatus(profile: PlayerProfileSummary): PlayerProfileLoadStatus {
  if (profile.error !== undefined) {
    return /timed out|taking longer/i.test(profile.error) ? 'timeout' : 'error';
  }

  if (profile.statsPrivate === true && !hasUsableProfileStats(profile)) {
    return 'private';
  }

  return 'loaded';
}

function hasUsableProfileStats(profile: PlayerProfileSummary): boolean {
  return (
    typeof profile.matches === 'number' ||
    (profile.topUmas?.length ?? 0) > 0 ||
    (profile.bestUmas?.length ?? 0) > 0 ||
    (profile.allUmas?.length ?? 0) > 0 ||
    (profile.recentMatches?.length ?? 0) > 0 ||
    (typeof profile.currentSeasonStats?.matches === 'number' && profile.currentSeasonStats.matches > 0) ||
    (typeof profile.allTimeStats?.matches === 'number' && profile.allTimeStats.matches > 0)
  );
}

function getLoadingDiscordIds(profileStates: Record<string, PlayerProfileLoadState>): string[] {
  return Object.values(profileStates)
    .filter(isPendingProfileState)
    .map((state) => state.discordId);
}

function getErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function isPendingProfileState(state: PlayerProfileLoadState | undefined): boolean {
  return state?.status === 'loading' || state?.status === 'queued';
}

function getRetainedProfiles(
  cachedProfiles: Record<string, PlayerProfileSummary>,
  freshProfiles: Record<string, PlayerProfileSummary>,
  discordIds: string[]
): Record<string, PlayerProfileSummary> {
  return Object.fromEntries(
    discordIds
      .map((discordId) => [discordId, cachedProfiles[discordId] ?? freshProfiles[discordId]] as const)
      .filter((entry): entry is readonly [string, PlayerProfileSummary] => (
        entry[1] !== undefined &&
        (entry[1].error === undefined || hasUsableProfileStats(entry[1]))
      ))
  );
}

function isDiscordSnowflake(value: string): boolean {
  return /^\d{16,20}$/.test(value);
}

function hasCurrentStatsShape(profile: PlayerProfileSummary): boolean {
  return (
    profile.currentSeasonStats !== undefined &&
    profile.allTimeStats !== undefined &&
    Array.isArray(profile.allTimeStats.allUmas)
  );
}

export {
  MAX_AUTOMATIC_RETRIES,
  buildProfileLoadStates,
  buildCompletedProfileState,
  getProfileLoadStatus,
  hasUsableProfileStats,
  retainUsableProfile,
  getRetainedProfiles,
  markProfilesForRecovery,
  getLoadingDiscordIds,
  isPendingProfileState,
  hasCurrentStatsShape,
  isDiscordSnowflake,
  getErrorMessage
};
