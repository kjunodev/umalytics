import type { PlayerProfileSummary } from '@umalytics/shared';
import { formatDecimal, formatPercent } from './format';

export type NotableBadgeTone = 'rank' | 'scoring' | 'sample' | 'private';

export interface NotableBadge {
  label: string;
  tone: NotableBadgeTone;
  title: string;
}

export function getNotableBadges(profile: PlayerProfileSummary | undefined): NotableBadge[] {
  if (profile === undefined) {
    return [];
  }

  if (profile.statsPrivate === true && !hasUsableProfileStats(profile)) {
    return [
      {
        label: 'Private',
        tone: 'private',
        title: 'This player keeps ranked profile stats private.'
      }
    ];
  }

  const badges: NotableBadge[] = [];

  if (profile.rank !== undefined && profile.rank !== null) {
    if (profile.rank <= 10) {
      badges.push({
        label: 'Top 10',
        tone: 'rank',
        title: 'Current-season leaderboard rank is top 10.'
      });
    } else if (profile.rank <= 25) {
      badges.push({
        label: 'Top 25',
        tone: 'rank',
        title: 'Current-season leaderboard rank is top 25.'
      });
    }
  }

  if (
    profile.pointsPerGame !== undefined &&
    profile.pointsPerGame !== null &&
    profile.matches !== undefined &&
    profile.matches !== null &&
    profile.matches >= 5 &&
    profile.pointsPerGame >= 7
  ) {
    badges.push({
      label: 'Elite scoring',
      tone: 'scoring',
      title: 'Averages at least 7.0 points per ranked game with 5+ games in the selected stat scope.'
    });
  } else if (
    profile.pointsPerGame !== undefined &&
    profile.pointsPerGame !== null &&
    profile.matches !== undefined &&
    profile.matches !== null &&
    profile.matches >= 5 &&
    profile.pointsPerGame >= 6
  ) {
    badges.push({
      label: 'High scoring',
      tone: 'scoring',
      title: 'Averages at least 6.0 points per ranked game in the selected stat scope.'
    });
  }

  if (
    profile.matches !== undefined &&
    profile.matches !== null &&
    profile.matches >= 25 &&
    profile.pointsPerGame !== undefined &&
    profile.pointsPerGame !== null &&
    profile.pointsPerGame >= 5.5
  ) {
    badges.push({
      label: 'Established',
      tone: 'sample',
      title: `${profile.matches} ranked games while averaging ${formatDecimal(profile.pointsPerGame)} points per game in the selected stat scope.`
    });
  }

  if (
    profile.recentForm !== undefined &&
    profile.recentForm.matches >= 5 &&
    profile.recentForm.scoringRate !== null &&
    profile.recentForm.scoringRate >= 0.75
  ) {
    badges.push({
      label: 'Consistent',
      tone: 'sample',
      title: `Scored points in ${formatPercent(profile.recentForm.scoringRate)} of the last ${profile.recentForm.matches} confirmed ranked matches.`
    });
  }

  return badges;
}

export function hasUsableProfileStats(profile: PlayerProfileSummary | undefined): boolean {
  return (
    (profile?.topUmas?.length ?? 0) > 0 ||
    (profile?.bestUmas?.length ?? 0) > 0 ||
    (profile?.allUmas?.length ?? 0) > 0 ||
    (profile?.recentMatches?.length ?? 0) > 0
  );
}
