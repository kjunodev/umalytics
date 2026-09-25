import type { PlayerProfileSummary } from '@umalytics/shared';
import { formatDecimal, formatPercent } from './format';

export type NotableBadgeTone = 'rank' | 'scoring' | 'sample' | 'private';
export type NotableBadgeKind = 'private' | 'top10' | 'top25' | 'eliteScoring' | 'highScoring' | 'established' | 'consistent' | 'mvpMenace';

export interface NotableBadge {
  kind: NotableBadgeKind;
  label: string;
  tone: NotableBadgeTone;
  title: string;
}

export function getNotableBadges(profile: PlayerProfileSummary | undefined): NotableBadge[] {
  if (profile === undefined) {
    return [];
  }

  if (profile.statsPrivate === true && !hasDisplayableProfileLists(profile)) {
    return [
      {
        kind: 'private',
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
        kind: 'top10',
        label: 'Top 10',
        tone: 'rank',
        title: 'Current-season leaderboard rank is top 10.'
      });
    } else if (profile.rank <= 25) {
      badges.push({
        kind: 'top25',
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
      kind: 'eliteScoring',
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
      kind: 'highScoring',
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
      kind: 'established',
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
      kind: 'consistent',
      label: 'Consistent',
      tone: 'sample',
      title: `Scored points in ${formatPercent(profile.recentForm.scoringRate)} of the last ${profile.recentForm.matches} confirmed ranked matches.`
    });
  }

  if (profile.matches !== undefined && profile.matches !== null && profile.matches >= 20 &&
    profile.mvpMatches !== undefined && profile.mvpMatches !== null &&
    profile.mvpMatches / profile.matches >= 0.2) {
    badges.push({
      kind: 'mvpMenace',
      label: 'MVP Menace',
      tone: 'scoring',
      title: 'Earned MVP in at least 20% of ranked games with 20+ games in the selected stat scope.'
    });
  }

  return badges;
}

export function hasDisplayableProfileLists(profile: PlayerProfileSummary | undefined): boolean {
  return (
    (profile?.topUmas?.length ?? 0) > 0 ||
    (profile?.bestUmas?.length ?? 0) > 0 ||
    (profile?.allUmas?.length ?? 0) > 0 ||
    (profile?.recentMatches?.length ?? 0) > 0
  );
}
