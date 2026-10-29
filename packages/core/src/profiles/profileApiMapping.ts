import type {
  PlayerRecentMatchSummary,
  PlayerProfileStatsSummary,
  PlayerTopUmaSummary,
  PrematchPlayer
} from '@umalytics/shared';
import {
  BEST_UMA_MIN_MATCHES,
  BEST_UMA_SCORE_VERSION,
  RECENT_HISTORY_VERSION
} from './profileConstants';
import { releaseOrder } from '../umas/umaReleaseOrder';
import { getUmaDisplayName, getUmaPortraitUrl, normalizeUmaOutfitId } from '../umas/umaPortraits';

export const PROFILE_ORIGIN = 'https://drafter.uma.guide';

export interface ApiPlayerProfile {
  displayName?: string;
  discordUsername?: string;
  nickname?: string | null;
  title?: string | null;
}

export interface ApiPlayerStats {
  umaEntries?: ApiUmaEntry[];
  summary?: {
    matchesIncluded?: number;
    totalPointsScored?: number;
    totalPodiumPlacements?: number;
    totalMvpMatches?: number;
  };
}

export interface ApiHistoryEntry {
  matchId: string;
  reportedAt: string;
  mode: string;
  verificationState: string;
  selectedUmaId: string | null;
  isWinner: boolean | null;
  pointsScored: number;
  podiumPlacements: number;
  isMvp: boolean;
  eloDelta: number | null;
  eloPlacement: boolean;
  umaAssignments?: Array<{ ordinal: number; umaId?: string | null }>;
}

export interface ApiUmaEntry {
  umaId?: string | null;
  matches?: number;
  wins?: number;
  losses?: number;
  pointsScored?: number;
  podiumPlacements?: number;
  mvpMatches?: number;
}

export interface ApiSeason {
  id?: string | null;
  name?: string | null;
  active?: boolean;
}

export interface ApiLeaderboard {
  entries?: ApiLeaderboardEntry[];
}

export interface ApiLeaderboardEntry {
  userId?: string;
  displayName?: string | null;
  rating?: number;
  rd?: number;
  wins?: number;
  losses?: number;
}

export interface UmaMetadata {
  label: string;
  imageUrl?: string;
}

export type UmaMetadataLookup = Map<string, UmaMetadata>;

export function mapHistoryEntry(entry: ApiHistoryEntry): PlayerRecentMatchSummary {
  const umaId = entry.selectedUmaId;
  return {
    matchId: entry.matchId, reportedAt: entry.reportedAt, mode: entry.mode,
    verificationState: entry.verificationState, umaId,
    umaName: umaId === null ? 'Disqualified' : getUmaDisplayName(umaId),
    isWinner: entry.isWinner, result: entry.isWinner === null ? 'unknown' : entry.isWinner ? 'win' : 'loss',
    pointsScored: entry.pointsScored,
    podiums: entry.podiumPlacements, isMvp: entry.isMvp,
    eloDelta: entry.eloDelta, eloPlacement: entry.eloPlacement,
    umaAssignments: entry.umaAssignments
  };
}

export function getPreferredDisplayName(
  leaderboardEntry: ApiLeaderboardEntry | undefined,
  player: PrematchPlayer
): string {
  return [
    leaderboardEntry?.displayName,
    player.displayName
  ].map(getUsableDisplayName).find((name) => name !== undefined) ?? player.displayName;
}

function getUsableDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0 || isPlaceholderDisplayName(trimmedValue)) {
    return undefined;
  }

  return trimmedValue;
}

function isPlaceholderDisplayName(value: string): boolean {
  const normalizedValue = value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  return normalizedValue === ', to view' || normalizedValue === 'to view' || normalizedValue === 'sign in to view';
}

export function buildReleaseOrderUmaMetadata(): UmaMetadataLookup {
  return new Map(
    releaseOrder.map((entry) => {
      const label = getUmaDisplayName(entry.outfitId, entry.name);
      const imageUrl = getUmaPortraitUrl(entry.outfitId, PROFILE_ORIGIN);
      const metadata: UmaMetadata = imageUrl === undefined ? { label } : { label, imageUrl };

      return [entry.outfitId, metadata] as const;
    })
  );
}

function buildStatsSummary(
  stats: ApiPlayerStats | undefined,
  umaMetadata: UmaMetadataLookup
): PlayerProfileStatsSummary {
  if (stats === undefined) {
    return buildEmptyStatsSummary();
  }

  const record = getRecordFromUmaEntries(stats.umaEntries);
  const wins = record.wins;
  const losses = record.losses;
  const matches = stats.summary?.matchesIncluded ?? addNullable(wins, losses);
  const points = stats.summary?.totalPointsScored;
  const recentMatches: PlayerRecentMatchSummary[] = [];
  const resolutionSummary = { unresolvedUmaMatches: 0, disqualifiedMatches: 0 };

  return {
    wins,
    losses,
    winRate: wins !== null && losses !== null && wins + losses > 0 ? wins / (wins + losses) : null,
    matches,
    points: points ?? null,
    pointsPerGame: points !== undefined && matches !== null && matches > 0 ? points / matches : null,
    podiums: stats.summary?.totalPodiumPlacements ?? null,
    mvpMatches: stats.summary?.totalMvpMatches ?? null,
    topUmas: getTopPlayedUmas(stats.umaEntries, umaMetadata),
    bestUmas: getBestPerformingUmas(stats.umaEntries, umaMetadata),
    allUmas: getAllPlayedUmas(stats.umaEntries, umaMetadata),
    recentMatches,
    unresolvedUmaMatches: resolutionSummary.unresolvedUmaMatches,
    disqualifiedMatches: resolutionSummary.disqualifiedMatches,
    bestUmaScoreVersion: BEST_UMA_SCORE_VERSION,
    recentHistoryVersion: RECENT_HISTORY_VERSION
  };
}

export function buildProfileStatsSummary(stats: ApiPlayerStats | undefined, umaMetadata: UmaMetadataLookup): PlayerProfileStatsSummary {
  return stats === undefined ? buildEmptyStatsSummary() : buildStatsSummary(stats, umaMetadata);
}

export function buildEmptyStatsSummary(

): PlayerProfileStatsSummary {
  const recentMatches: PlayerRecentMatchSummary[] = [];
  const resolutionSummary = { unresolvedUmaMatches: 0, disqualifiedMatches: 0 };

  return {
    wins: null,
    losses: null,
    winRate: null,
    matches: null,
    points: null,
    pointsPerGame: null,
    podiums: null,
    mvpMatches: null,
    topUmas: [],
    bestUmas: [],
    allUmas: [],
    recentMatches,
    unresolvedUmaMatches: resolutionSummary.unresolvedUmaMatches,
    disqualifiedMatches: resolutionSummary.disqualifiedMatches,
    bestUmaScoreVersion: BEST_UMA_SCORE_VERSION,
    recentHistoryVersion: RECENT_HISTORY_VERSION
  };
}

export function getRecordFromUmaEntries(
  umaEntries: ApiUmaEntry[] | undefined
): { wins: number | null; losses: number | null } {
  if (umaEntries === undefined) {
    return { wins: null, losses: null };
  }

  return umaEntries.reduce<{ wins: number; losses: number }>(
    (record, entry) => ({
      wins: record.wins + (entry.wins ?? 0),
      losses: record.losses + (entry.losses ?? 0)
    }),
    { wins: 0, losses: 0 }
  );
}

function getTopPlayedUmas(
  umaEntries: ApiUmaEntry[] | undefined,
  umaMetadata: UmaMetadataLookup
): PlayerTopUmaSummary[] {
  if (umaEntries === undefined) {
    return [];
  }

  return mergeUmaEntriesByOutfitId(umaEntries)
    .filter((entry) => isKnownUmaId(entry.umaId) && (entry.matches ?? 0) > 0)
    .sort((left, right) => (right.matches ?? 0) - (left.matches ?? 0))
    .slice(0, 3)
    .map((entry) => buildUmaSummary(entry, umaMetadata));
}

function getAllPlayedUmas(
  umaEntries: ApiUmaEntry[] | undefined,
  umaMetadata: UmaMetadataLookup
): PlayerTopUmaSummary[] {
  if (umaEntries === undefined) {
    return [];
  }

  return mergeUmaEntriesByOutfitId(umaEntries)
    .filter((entry) => isKnownUmaId(entry.umaId) && (entry.matches ?? 0) > 0)
    .sort((left, right) => (right.matches ?? 0) - (left.matches ?? 0))
    .map((entry) => buildUmaSummary(entry, umaMetadata));
}

function getBestPerformingUmas(
  umaEntries: ApiUmaEntry[] | undefined,
  umaMetadata: UmaMetadataLookup
): PlayerTopUmaSummary[] {
  if (umaEntries === undefined) {
    return [];
  }

  return mergeUmaEntriesByOutfitId(umaEntries)
    .filter((entry) => isKnownUmaId(entry.umaId) && (entry.matches ?? 0) >= BEST_UMA_MIN_MATCHES)
    .map((entry) => buildUmaSummary(entry, umaMetadata))
    .sort((left, right) => {
      const scoreDelta = (right.performanceScore ?? 0) - (left.performanceScore ?? 0);

      if (scoreDelta !== 0) return scoreDelta;

      const ppgDelta = (right.pointsPerGame ?? 0) - (left.pointsPerGame ?? 0);

      if (ppgDelta !== 0) return ppgDelta;

      const winRateDelta = (right.winRate ?? 0) - (left.winRate ?? 0);

      if (winRateDelta !== 0) return winRateDelta;

      return right.matches - left.matches;
    })
    .slice(0, 5);
}

function buildUmaSummary(
  entry: ApiUmaEntry,
  umaMetadata: UmaMetadataLookup
): PlayerTopUmaSummary {
  const umaId = normalizeUmaOutfitId(entry.umaId ?? '');
  const metadata = umaMetadata.get(umaId);
  const matches = entry.matches ?? 0;
  const wins = entry.wins ?? 0;
  const losses = entry.losses ?? 0;
  const points = entry.pointsScored ?? 0;
  const podiums = entry.podiumPlacements ?? 0;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : null;
  const pointsPerGame = matches > 0 ? points / matches : null;
  const podiumRate = matches > 0 ? Math.min(Math.max(podiums / (matches * 3), 0), 1) : null;

  return {
    umaId,
    name: getUmaDisplayName(umaId, metadata?.label),
    imageUrl: metadata?.imageUrl ?? getUmaPortraitUrl(umaId, PROFILE_ORIGIN),
    matches,
    wins,
    losses,
    winRate,
    points,
    pointsPerGame,
    podiums,
    mvpMatches: entry.mvpMatches ?? 0,
    performanceScore: calculatePerformanceScore(pointsPerGame, winRate, podiumRate)
  };
}

function mergeUmaEntriesByOutfitId(umaEntries: ApiUmaEntry[]): ApiUmaEntry[] {
  const mergedEntries = new Map<string, Required<ApiUmaEntry>>();

  for (const entry of umaEntries) {
    if (!isKnownUmaId(entry.umaId)) {
      continue;
    }

    const umaId = normalizeUmaOutfitId(entry.umaId);
    const current = mergedEntries.get(umaId) ?? {
      umaId,
      matches: 0,
      wins: 0,
      losses: 0,
      pointsScored: 0,
      podiumPlacements: 0,
      mvpMatches: 0
    };

    current.matches += entry.matches ?? 0;
    current.wins += entry.wins ?? 0;
    current.losses += entry.losses ?? 0;
    current.pointsScored += entry.pointsScored ?? 0;
    current.podiumPlacements += entry.podiumPlacements ?? 0;
    current.mvpMatches += entry.mvpMatches ?? 0;
    mergedEntries.set(umaId, current);
  }

  return [...mergedEntries.values()];
}

function isKnownUmaId(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmedValue = value.trim();

  return (
    trimmedValue.length > 0 &&
    !/^(unknown|undefined|null|disqualified|\?|u)$/i.test(trimmedValue)
  );
}

function calculatePerformanceScore(
  pointsPerGame: number | null,
  winRate: number | null,
  podiumRate: number | null
): number {
  const normalizedPpg = Math.min(Math.max((pointsPerGame ?? 0) / 8, 0), 1);
  const normalizedWinRate = Math.min(Math.max(winRate ?? 0, 0), 1);
  const normalizedPodiumRate = Math.min(Math.max(podiumRate ?? 0, 0), 1);

  return Math.round((normalizedPpg * 0.7 + normalizedWinRate * 0.2 + normalizedPodiumRate * 0.1) * 100);
}


function addNullable(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}
