import type { PlayerProfileSummary, PlayerTopUmaSummary } from '@umalytics/shared';
import { formatDecimal, formatPercent } from './format';
import { NEWCOMER_MAX_ALL_TIME_MATCHES } from '../../profiles/profileConstants';

export type NotableBadgeTone = 'rank' | 'scoring' | 'sample' | 'style' | 'private';
export type NotableBadgeKind =
  | 'private'
  | 'top10'
  | 'top25'
  | 'eliteScoring'
  | 'highScoring'
  | 'established'
  | 'consistent'
  | 'mvpMenace'
  | 'oneTrick'
  | 'deepPool'
  | 'podiumRegular'
  | 'underrated'
  | 'newcomer';

export interface NotableBadge {
  kind: NotableBadgeKind;
  label: string;
  tone: NotableBadgeTone;
  title: string;
}

const ONE_TRICK_MIN_SHARE = 0.4;
const ONE_TRICK_MIN_GAMES = 20;
const DEEP_POOL_MIN_UMAS = 8;
const DEEP_POOL_MIN_GAMES_PER_UMA = 3;
const PODIUM_REGULAR_MIN_RATE = 0.6;
const PODIUM_REGULAR_MIN_GAMES = 15;
const UNDERRATED_MIN_PPG = 5.5;
const UNDERRATED_MIN_GAMES = 15;
const UNDERRATED_MAX_RANK = 100;

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

  if (
    profile.podiums !== undefined &&
    profile.podiums !== null &&
    profile.matches !== undefined &&
    profile.matches !== null &&
    profile.matches >= PODIUM_REGULAR_MIN_GAMES &&
    profile.podiums / profile.matches >= PODIUM_REGULAR_MIN_RATE
  ) {
    const rate = profile.podiums / profile.matches;
    badges.push({
      kind: 'podiumRegular',
      label: 'Podium regular',
      tone: 'scoring',
      title: `Podiums in ${formatPercent(rate)} of ranked games (${profile.podiums} of ${profile.matches}), with ${PODIUM_REGULAR_MIN_GAMES}+ games in the selected stat scope.`
    });
  }

  if (
    profile.pointsPerGame !== undefined &&
    profile.pointsPerGame !== null &&
    profile.pointsPerGame >= UNDERRATED_MIN_PPG &&
    profile.matches !== undefined &&
    profile.matches !== null &&
    profile.matches >= UNDERRATED_MIN_GAMES &&
    (profile.rank === undefined || profile.rank === null || profile.rank > UNDERRATED_MAX_RANK)
  ) {
    const rankLabel = profile.rank === undefined || profile.rank === null ? 'unranked' : `ranked #${profile.rank}`;
    badges.push({
      kind: 'underrated',
      label: 'Underrated',
      tone: 'scoring',
      title: `Averages ${formatDecimal(profile.pointsPerGame)} points per game over ${profile.matches} games while ${rankLabel}, outside the top ${UNDERRATED_MAX_RANK}.`
    });
  }

  const oneTrick = getOneTrickBadge(profile);
  if (oneTrick !== undefined) {
    badges.push(oneTrick);
  } else {
    const deepPool = getDeepPoolBadge(profile);
    if (deepPool !== undefined) {
      badges.push(deepPool);
    }
  }

  const newcomer = getNewcomerBadge(profile);
  if (newcomer !== undefined) {
    badges.push(newcomer);
  }

  return badges;
}

function getOneTrickBadge(profile: PlayerProfileSummary): NotableBadge | undefined {
  if (profile.matches === undefined || profile.matches === null || profile.matches < ONE_TRICK_MIN_GAMES) {
    return undefined;
  }

  const topUma = getMostPlayedUma(profile.allUmas);
  if (topUma === undefined) {
    return undefined;
  }

  const share = topUma.matches / profile.matches;
  if (share < ONE_TRICK_MIN_SHARE) {
    return undefined;
  }

  return {
    kind: 'oneTrick',
    label: 'One-trick',
    tone: 'style',
    title: `${topUma.name} in ${formatPercent(share)} of games (${topUma.matches} of ${profile.matches}).`
  };
}

function getDeepPoolBadge(profile: PlayerProfileSummary): NotableBadge | undefined {
  const umasWithEnoughGames = (profile.allUmas ?? []).filter((uma) => uma.matches >= DEEP_POOL_MIN_GAMES_PER_UMA);
  if (umasWithEnoughGames.length < DEEP_POOL_MIN_UMAS) {
    return undefined;
  }

  return {
    kind: 'deepPool',
    label: 'Deep pool',
    tone: 'style',
    title: `${umasWithEnoughGames.length} different Umas with ${DEEP_POOL_MIN_GAMES_PER_UMA}+ games each in the selected stat scope.`
  };
}

function getMostPlayedUma(allUmas: PlayerTopUmaSummary[] | undefined): PlayerTopUmaSummary | undefined {
  if (allUmas === undefined || allUmas.length === 0) {
    return undefined;
  }

  return allUmas.reduce((most, uma) => (uma.matches > most.matches ? uma : most), allUmas[0]!);
}

function getNewcomerBadge(profile: PlayerProfileSummary): NotableBadge | undefined {
  if (profile.statsScope === 'allTime') {
    if (profile.matches === undefined || profile.matches === null) {
      return undefined;
    }

    return profile.matches < NEWCOMER_MAX_ALL_TIME_MATCHES ? buildNewcomerBadge(profile.matches) : undefined;
  }

  if (profile.matches !== undefined && profile.matches !== null && profile.matches >= NEWCOMER_MAX_ALL_TIME_MATCHES) {
    return undefined;
  }

  const allTimeMatches = profile.allTimeStats?.matches;
  if (allTimeMatches === undefined || allTimeMatches === null) {
    return undefined;
  }

  return allTimeMatches < NEWCOMER_MAX_ALL_TIME_MATCHES ? buildNewcomerBadge(allTimeMatches) : undefined;
}

function buildNewcomerBadge(allTimeMatches: number): NotableBadge {
  return {
    kind: 'newcomer',
    label: 'Newcomer',
    tone: 'sample',
    title: `Fewer than ${NEWCOMER_MAX_ALL_TIME_MATCHES} ranked games all-time (${allTimeMatches} total).`
  };
}

export function hasDisplayableProfileLists(profile: PlayerProfileSummary | undefined): boolean {
  return (
    (profile?.topUmas?.length ?? 0) > 0 ||
    (profile?.bestUmas?.length ?? 0) > 0 ||
    (profile?.allUmas?.length ?? 0) > 0 ||
    (profile?.recentMatches?.length ?? 0) > 0
  );
}
