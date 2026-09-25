import type { PlayerProfileSummary, PlayerRecentMatchSummary, PlayerStatsScope, PrematchPlayer } from '@umalytics/shared';
import { hasDisplayableProfileLists } from '../common/badges';
import { formatRelativeAge } from '../common/format';
declare const __UMALYTICS_PRIVATE_PROFILE_DATA__: boolean;

export function withDetailHistory(
  profile: PlayerProfileSummary | undefined, firstPageMatches: PlayerRecentMatchSummary[],
  total: number, summary?: PlayerProfileSummary['historySummary']
): PlayerProfileSummary | undefined {
  if (profile === undefined) return undefined;
  const recentMatches = firstPageMatches.filter(match =>
    ['confirmed', 'corrected', 'reported'].includes(match.verificationState)).slice(0, 5);
  const privateBuild = typeof __UMALYTICS_PRIVATE_PROFILE_DATA__ !== 'undefined' && __UMALYTICS_PRIVATE_PROFILE_DATA__;
  const confirmed = privateBuild ? recentMatches.filter(match => match.verificationState === 'confirmed') : [];
  const matches = confirmed.length;
  const scoredMatches = confirmed.filter(match => match.pointsScored > 0).length;
  const wins = confirmed.filter(match => match.isWinner === true).length;
  const points = confirmed.reduce((sum, match) => sum + match.pointsScored, 0);
  return {
    ...profile, recentMatches, historyTotal: total, historySummary: privateBuild ? summary : undefined,
    recentHistoryStatus: 'loaded',
    recentForm: privateBuild ? {
      matches, scoredMatches, scoringRate: matches > 0 ? scoredMatches / matches : null,
      wins, winRate: matches > 0 ? wins / matches : null, points,
      pointsPerGame: matches > 0 ? points / matches : null,
      podiums: confirmed.reduce((sum, match) => sum + match.podiums, 0),
      mvpMatches: confirmed.filter(match => match.isMvp).length
    } : undefined
  };
}

export function getLookupDiscordId(player: PrematchPlayer): string | undefined {
  return /^\d{16,20}$/.test(player.discordId) ? player.discordId : undefined;
}

export function StatCell({
  label,
  value,
  title,
  variant
}: {
  label: string;
  value: string;
  title: string;
  variant?: 'record';
}) {
  return (
    <span className={variant === 'record' ? 'stat-cell record-stat-cell' : 'stat-cell'} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

export function ProfileDataStatus({
  discordId,
  profile,
  isProfileLoading,
  now
}: {
  discordId: string | undefined;
  profile: PlayerProfileSummary | undefined;
  isProfileLoading: boolean;
  now: number;
}) {
  const status = getProfileDataStatus(discordId, profile, isProfileLoading, now);

  return (
    <div className={`profile-data-status ${status.tone}`}>
      <span>{status.label}</span>
    </div>
  );
}

export function getDisplayedProfileStats(
  profile: PlayerProfileSummary | undefined,
  statsScope: PlayerStatsScope
): PlayerProfileSummary | undefined {
  if (profile === undefined) {
    return undefined;
  }

  const stats = statsScope === 'allTime' ? profile.allTimeStats : profile.currentSeasonStats;

  if (stats === undefined) {
    return profile;
  }

  return {
    ...profile,
    ...stats,
    statsScope,
    ...(profile.scopeFetchedAt && profile.scopeFetchedAt[statsScope] === undefined ? { matches: null, wins: null, losses: null, winRate: null, points: null, pointsPerGame: null, mvpMatches: null, allUmas: [], bestUmas: [], topUmas: [], recentMatches: [], recentHistoryStatus: 'unavailable' as const } : {})
  };
}

export function getProfileDataStatus(
  discordId: string | undefined,
  profile: PlayerProfileSummary | undefined,
  isProfileLoading: boolean,
  now: number
): { label: string; tone: 'fresh' | 'loading' | 'warning' | 'muted' } {
  if (discordId === undefined) {
    return {
      label: 'Profile link unavailable from room page',
      tone: 'muted'
    };
  }

  if (isProfileLoading) {
    return {
      label: 'Refreshing profile data',
      tone: 'loading'
    };
  }

  if (profile === undefined) {
    return {
      label: 'Profile data has not loaded yet.',
      tone: 'muted'
    };
  }

  if (profile.statsPrivate === true && !hasDisplayableProfileLists(profile)) {
    return {
      label: `Stats private - checked ${formatRelativeAge(profile.fetchedAt, now)}`,
      tone: 'warning'
    };
  }

  if (profile.error !== undefined) {
    return {
      label: `Profile unavailable - checked ${formatRelativeAge(profile.fetchedAt, now)}`,
      tone: 'warning'
    };
  }

  return {
    label: `Profile data current - updated ${formatRelativeAge(profile.fetchedAt, now)}`,
    tone: 'fresh'
  };
}

export function getPlayerNote(
  profile: PlayerProfileSummary | undefined,
  discordId: string | undefined
): string | undefined {
  if (discordId === undefined) {
    return 'Open their Uma profile once available to scout detailed stats.';
  }

  if (profile === undefined) {
    return 'Profile data has not loaded yet.';
  }

  if (profile.statsPrivate === true && !hasDisplayableProfileLists(profile)) {
    return 'Stats are private.';
  }

  if (profile.error === undefined) return undefined;
  if (/API paused|HTTP (429|5\d\d)/.test(profile.error)) return 'The stats API is temporarily unavailable. Check Diagnostics for the retry status.';
  if (/timed out/i.test(profile.error)) return 'Stats request timed out. You can retry with Refresh.';
  return 'Some profile data could not load. See Diagnostics for details.';
}

export function getStatsMessage(
  displayedProfile: PlayerProfileSummary | undefined,
  profile: PlayerProfileSummary | undefined,
  isProfileLoading: boolean,
  discordId: string | undefined
): string | undefined {
  if (isProfileLoading && discordId !== undefined) {
    return 'Loading ranked Uma stats.';
  }

  if (discordId === undefined) {
    return 'Profile lookup is unavailable from this room page.';
  }

  if (profile?.statsPrivate === true && !hasDisplayableProfileLists(displayedProfile)) {
    return 'Ranked Uma stats are private.';
  }

  if (profile?.error !== undefined) {
    return 'Unable to load ranked Uma stats.';
  }

  if (profile === undefined) {
    return 'Profile data has not loaded yet.';
  }

  return undefined;
}
