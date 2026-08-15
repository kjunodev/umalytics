export interface PlayerTopUmaSummary {
  umaId: string;
  name: string;
  imageUrl?: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number | null;
  points: number;
  pointsPerGame: number | null;
  podiums: number;
  mvpMatches: number;
  performanceScore?: number;
}

export interface PlayerRecentMatchSummary {
  matchId: string;
  reportedAt: string;
  mode: string;
  verificationState: string;
  umaId: string | null;
  umaName: string;
  isWinner: boolean | null;
  pointsScored: number;
  podiums: number;
  isMvp: boolean;
  eloDelta?: number | null;
}

export interface PlayerRecentFormSummary {
  matches: number;
  scoredMatches: number;
  scoringRate: number | null;
  wins: number;
  winRate: number | null;
  points: number;
  pointsPerGame: number | null;
  podiums: number;
  mvpMatches: number;
}

export type PlayerStatsScope = 'currentSeason' | 'allTime';

export interface PlayerProfileStatsSummary {
  wins?: number | null;
  losses?: number | null;
  winRate?: number | null;
  matches?: number | null;
  points?: number | null;
  pointsPerGame?: number | null;
  podiums?: number | null;
  mvpMatches?: number | null;
  topUmas?: PlayerTopUmaSummary[];
  bestUmas?: PlayerTopUmaSummary[];
  allUmas?: PlayerTopUmaSummary[];
  recentMatches?: PlayerRecentMatchSummary[];
  recentForm?: PlayerRecentFormSummary;
  bestUmaScoreVersion?: number;
  recentHistoryVersion?: number;
}

export interface PlayerProfileSummary {
  discordId: string;
  displayName?: string;
  discordUsername?: string;
  title?: string | null;
  rank?: number | null;
  rating?: number | null;
  ratingDeviation?: number | null;
  conservativeRating?: number | null;
  wins?: number | null;
  losses?: number | null;
  winRate?: number | null;
  matches?: number | null;
  points?: number | null;
  pointsPerGame?: number | null;
  podiums?: number | null;
  mvpMatches?: number | null;
  topUmas?: PlayerTopUmaSummary[];
  bestUmas?: PlayerTopUmaSummary[];
  allUmas?: PlayerTopUmaSummary[];
  recentMatches?: PlayerRecentMatchSummary[];
  recentForm?: PlayerRecentFormSummary;
  bestUmaScoreVersion?: number;
  recentHistoryVersion?: number;
  statsScope?: PlayerStatsScope;
  currentSeasonStats?: PlayerProfileStatsSummary;
  allTimeStats?: PlayerProfileStatsSummary;
  activeSeasonId?: string;
  statsPrivate?: boolean;
  fetchedAt: number;
  profileUrl: string;
  error?: string;
}
