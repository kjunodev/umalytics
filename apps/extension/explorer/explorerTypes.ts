import type { DraftSnapshot, PlayerProfileSummary, PlayerStatsScope, PrematchPlayer, PrematchRoster } from '@umalytics/shared';
import type { SeasonLeaderboard } from '../profiles/playerProfileApi';

export interface HistoricalMatch {
  matchCode: string;
  roster: PrematchRoster;
  draft: DraftSnapshot;
  completedAt?: string;
  status: string;
  warnings: string[];
}

export interface PlayerSearchResult {
  players: PrematchPlayer[];
  total: number;
  page: number;
  pageSize: number;
}

export type ExplorerRequest =
  | { kind: 'leaderboard' }
  | { kind: 'match'; input: string }
  | { kind: 'search'; input: string; page: number }
  | { kind: 'profiles'; players: PrematchPlayer[]; scope: PlayerStatsScope; estimate?: boolean };

export type ExplorerResult = HistoricalMatch | PlayerSearchResult | SeasonLeaderboard | Record<string, PlayerProfileSummary>;
export type ExplorerReply =
  | { type: 'result'; data: ExplorerResult }
  | { type: 'progress'; profiles: Record<string, PlayerProfileSummary> }
  | { type: 'error'; message: string; retryAt?: number };
export const EXPLORER_PORT = 'umalytics-explorer-v1';
