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
  result?: 'win' | 'loss' | 'unknown';
  pointsScored: number;
  podiums: number;
  isMvp: boolean;
  eloDelta?: number | null;
  eloPlacement?: boolean;
  umaAssignments?: Array<{ ordinal: number; umaId?: string | null }>;
}

export interface PlayerHistorySummary {
  wins: number;
  losses: number;
  pointsScored: number;
  podiumPlacements: number;
  firstPlaceFinishes: number;
  secondPlaceFinishes: number;
  thirdPlaceFinishes: number;
  mvpAwards: number;
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
  recentHistoryStatus?: 'loading' | 'loaded' | 'unavailable' | 'private';
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
  historyTotal?: number;
  historySummary?: PlayerHistorySummary;
  recentForm?: PlayerRecentFormSummary;
  unresolvedUmaMatches?: number;
  disqualifiedMatches?: number;
  bestUmaScoreVersion?: number;
  recentHistoryVersion?: number;
}

export interface PlayerProfileSummary {
  recentHistoryStatus?: PlayerProfileStatsSummary['recentHistoryStatus'];
  /** Initial usable data, while remaining endpoints are still loading. */
  isPartial?: boolean;
  scopeFetchedAt?: Partial<Record<PlayerStatsScope, number>>;
  historyDerived?: boolean;
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
  historyTotal?: number;
  historySummary?: PlayerHistorySummary;
  recentForm?: PlayerRecentFormSummary;
  unresolvedUmaMatches?: number;
  disqualifiedMatches?: number;
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
