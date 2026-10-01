import type {
  PlayerProfileStatsSummary,
  PlayerProfileSummary,
  PlayerRecentMatchSummary,
  PrematchPlayer
} from '@umalytics/shared';
import {
  BEST_UMA_SCORE_VERSION,
  RECENT_HISTORY_VERSION
} from './profileConstants';
import { ApiRequestError, fetchJson, PROFILE_SUMMARY_TIMEOUT_MS } from './apiClient';
import {
  PROFILE_ORIGIN,
  buildEmptyStatsSummary,
  buildProfileStatsSummary,
  buildReleaseOrderUmaMetadata,
  getPreferredDisplayName,
  getRecordFromUmaEntries,
  mapHistoryEntry,
  type ApiHistoryEntry,
  type ApiLeaderboard,
  type ApiLeaderboardEntry,
  type ApiPlayerProfile,
  type ApiPlayerStats,
  type ApiSeason,
  type UmaMetadataLookup
} from './profileApiMapping';
import { abortable, deadline } from './requestQueue';
import { getErrorMessage } from '../room/recordReaders';
import { isDiscordSnowflake } from '../room/rosterIdentity';

const PROFILE_ERROR_FALLBACK = 'Unable to load profile.';

export interface PlayerHistoryPage { page: number; total: number; matches: PlayerRecentMatchSummary[]; summary?: PlayerProfileSummary['historySummary'] }

type CapturedFetch<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

interface LeaderboardLookup {
  error?: string;
  ranksByDiscordId: Map<string, ApiLeaderboardEntry & { rank: number }>;
  activeSeasonId?: string;
  activeSeasonName?: string;
}

export interface SeasonLeaderboardEntry {
  rank: number;
  userId: string;
  displayName?: string;
  rating?: number;
  rd?: number;
  wins?: number;
  losses?: number;
}

export interface SeasonLeaderboard {
  activeSeasonId?: string;
  /** Display name from the same cached /api/seasons response, e.g. "Season 2 (Grand Concert)". */
  activeSeasonName?: string;
  entries: SeasonLeaderboardEntry[];
}

interface SeasonLookup { activeSeasonId?: string; activeSeasonName?: string; error?: string }

let leaderboardRequest: Promise<LeaderboardLookup> | undefined;
let bundledUmaMetadata: UmaMetadataLookup | undefined;


export async function fetchPlayerProfileSummaries(
  players: PrematchPlayer[],
  options: {
    scope?: 'currentSeason' | 'allTime' | 'both';
    signal?: AbortSignal;
    onStart?: (player: PrematchPlayer) => void | Promise<void>;
    onStage?: (player: PrematchPlayer, stage: string) => void | Promise<void>;
    onSummary?: (summary: PlayerProfileSummary) => void | Promise<void>;
    onProgress?: (summary: PlayerProfileSummary) => void | Promise<void>;
    onWait?: (seconds: number) => void | Promise<void>;
    rosterComplete?: boolean;
  } = {}
): Promise<Record<string, PlayerProfileSummary>> {
  const uniquePlayers = uniqueByDiscordId(players);
  if (uniquePlayers.length === 0) return {};
  // The roster deadline starts before shared setup or the profile queue.
  const budget = deadline(options.signal, PROFILE_SUMMARY_TIMEOUT_MS, 'Profile loading timed out (including queue).');
  const umaMetadata = bundledUmaMetadata ??= buildReleaseOrderUmaMetadata();
  const scope = options.scope ?? 'both';
  const season = getActiveSeasonId();
  const leaderboard = getActiveLeaderboard(season);
  // Names come from the roster or search results; no /profile request during lobby loading.
  const allTimeRequests = uniquePlayers.map(player => scope === 'currentSeason' ? Promise.resolve(undefined) :
    captureFetch(fetchJson<ApiPlayerStats>(`/api/stats/players/${encodeURIComponent(player.discordId)}/stats?mode=ranked`, budget.signal, 'stats')));
  const seasonRequests = uniquePlayers.map(player => season.then(value =>
    scope === 'allTime' || value.activeSeasonId === undefined ? undefined :
      captureFetch(fetchJson<ApiPlayerStats>(`/api/stats/players/${encodeURIComponent(player.discordId)}/stats?mode=ranked&season=${encodeURIComponent(value.activeSeasonId)}`, budget.signal, 'stats'))));
  try {
    const summaries = await Promise.all(uniquePlayers.map(async (player, index) => {
      if (options.signal?.aborted) throw options.signal.reason;
      await options.onStart?.(player);
      const stage = async (value: string) => { await options.onStage?.(player, value); };
      const summary = await abortable(
        fetchPlayerProfileSummary(player, season, leaderboard, allTimeRequests[index]!, seasonRequests[index]!, umaMetadata, budget.signal, stage, async summary => {
          if (!options.signal?.aborted) await options.onProgress?.(summary);
        }, scope), budget.signal
      ).catch((caught) => buildUnavailablePlayerSummary(player, getErrorMessage(caught, PROFILE_ERROR_FALLBACK)));
      if (!options.signal?.aborted) await options.onSummary?.(summary);
      return summary;
    }));
    options.signal?.throwIfAborted();
    return Object.fromEntries(summaries.map((summary) => [summary.discordId, summary]));
  } finally {
    budget.dispose();
  }
}

export function buildUnavailablePlayerSummary(
  player: PrematchPlayer,
  error: string
): PlayerProfileSummary {
  return {
    discordId: player.discordId,
    displayName: player.displayName,
    rank: null,
    rating: player.displayRatingSnapshot ?? player.ratingSnapshot ?? null,
    ratingDeviation: player.displayRdSnapshot ?? player.rdSnapshot ?? null,
    conservativeRating: null,
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
    recentMatches: [],
    bestUmaScoreVersion: BEST_UMA_SCORE_VERSION,
    recentHistoryVersion: RECENT_HISTORY_VERSION,
    statsScope: 'currentSeason',
    currentSeasonStats: buildEmptyStatsSummary(),
    allTimeStats: buildEmptyStatsSummary(),
    statsPrivate: false,
    fetchedAt: Date.now(),
    profileUrl: `${PROFILE_ORIGIN}/players/${encodeURIComponent(player.discordId)}`,
    error
  };
}

async function captureFetch<T>(promise: Promise<T>): Promise<CapturedFetch<T>> {
  try {
    return {
      ok: true,
      value: await promise
    };
  } catch (error) {
    return {
      ok: false,
      error
    };
  }
}


function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export async function fetchPlayerHistoryPage(
  discordId: string, scope: 'allTime' | 'currentSeason', page: number,
  signal?: AbortSignal
): Promise<PlayerHistoryPage> {
  if (!isDiscordSnowflake(discordId) || !Number.isInteger(page) || page < 1) throw new Error('Invalid history request.');
  const season = scope === 'currentSeason' ? await getActiveSeasonId() : undefined;
  if (scope === 'currentSeason' && season?.activeSeasonId === undefined) throw new Error('Active season unavailable.');
  const query = `/api/stats/players/${encodeURIComponent(discordId)}/history?page=${page}&pageSize=20&mode=ranked${season?.activeSeasonId ? `&season=${encodeURIComponent(season.activeSeasonId)}` : ''}`;
  const result = await fetchJson<unknown>(query, signal, 'history');
  if (!isObject(result) || !Number.isInteger(result.total) || !Array.isArray(result.playerHistory)) throw new Error('Invalid history response.');
  return { page, total: result.total as number,
    summary: isObject(result.summary) ? result.summary as unknown as PlayerProfileSummary['historySummary'] : undefined,
    matches: result.playerHistory.map((entry: unknown) => {
    if (!isObject(entry) || typeof entry.matchId !== 'string') throw new Error('Invalid history entry.');
    return mapHistoryEntry(entry as unknown as ApiHistoryEntry);
  }) };
}

/** Fetched once when a player's details open; the response is cached for 24 hours. */
export async function fetchPlayerProfileTitle(discordId: string, signal?: AbortSignal): Promise<{ title: string | null }> {
  if (!isDiscordSnowflake(discordId)) throw new Error('Invalid profile request.');
  const profile = await fetchJson<ApiPlayerProfile>(`/api/stats/players/${encodeURIComponent(discordId)}/profile`, signal, 'profile');
  return { title: profile.title ?? null };
}

/**
 * Used only to check the newcomer badge's all-time match count when the
 * lobby is showing current-season stats. Hits the same all-time stats
 * endpoint (and shares the same request cache/dedup) as the per-scope fetch
 * in fetchPlayerProfileSummary, but at the lowest ('background') priority so
 * it never competes with the cards' own foreground requests.
 */
export async function fetchPlayerAllTimeStats(discordId: string, signal?: AbortSignal): Promise<PlayerProfileStatsSummary> {
  if (!isDiscordSnowflake(discordId)) throw new Error('Invalid profile request.');
  const umaMetadata = bundledUmaMetadata ??= buildReleaseOrderUmaMetadata();
  const stats = await fetchJson<ApiPlayerStats>(`/api/stats/players/${encodeURIComponent(discordId)}/stats?mode=ranked`, signal, 'background');
  return buildProfileStatsSummary(stats, umaMetadata);
}

async function fetchPlayerProfileSummary(
  player: PrematchPlayer,
  seasonPromise: Promise<SeasonLookup>,
  leaderboardPromise: Promise<LeaderboardLookup>,
  allTimeRequest: Promise<CapturedFetch<ApiPlayerStats> | undefined>,
  seasonRequest: Promise<CapturedFetch<ApiPlayerStats> | undefined>,
  umaMetadata: UmaMetadataLookup,
  signal: AbortSignal,
  onStage: (stage: string) => Promise<void>,
  onProgress: (summary: PlayerProfileSummary) => Promise<void>,
  scope: 'currentSeason' | 'allTime' | 'both'
): Promise<PlayerProfileSummary> {
  const profileUrl = `${PROFILE_ORIGIN}/players/${encodeURIComponent(player.discordId)}`;
  signal.throwIfAborted();
  await onStage(scope === 'currentSeason' ? 'Seasonal stats' : 'All-time stats');
  let allTimeStats: ApiPlayerStats | undefined;
  let currentSeasonStats: ApiPlayerStats | undefined;
  let allTimeStatsPrivate = false;
  let currentSeasonStatsPrivate = false;
  let statsPrivate = false;
  let error: string | undefined;
  let leaderboard: LeaderboardLookup = { ranksByDiscordId: new Map() };
  let activeSeasonId: string | undefined;
  const seasonReady = seasonPromise.then(value => { activeSeasonId = value.activeSeasonId; return value; });
  const seasonWithProgress = seasonRequest.then(async result => {
    if (result?.ok) currentSeasonStats = result.value;
    else if (result !== undefined && result.error instanceof ApiRequestError && result.error.status === 403) {
      currentSeasonStatsPrivate = true;
      statsPrivate = true;
    }
    if (!signal.aborted && (result?.ok || currentSeasonStatsPrivate)) await onProgress({ ...buildSummary(), isPartial: true });
    return result;
  });

  // Begin usable player data immediately; season/leaderboard setup runs alongside it.
  const allTimeStatsResult = await allTimeRequest.then(async result => {
    if (result === undefined) return undefined;
    if (result.ok) allTimeStats = result.value;
    else if (result.error instanceof ApiRequestError && result.error.status === 403) {
      allTimeStatsPrivate = true;
      statsPrivate = true;
    }
    signal.throwIfAborted();
    if (result.ok || allTimeStatsPrivate) await onProgress({ ...buildSummary(), isPartial: true });
    return result;
  });
  signal.throwIfAborted();

  if (allTimeStatsResult?.ok) {
    allTimeStats = allTimeStatsResult.value;
  } else if (allTimeStatsResult !== undefined && allTimeStatsResult.error instanceof ApiRequestError && allTimeStatsResult.error.status === 403) {
    allTimeStatsPrivate = true;
    statsPrivate = true;
  } else {
    if (allTimeStatsResult !== undefined) error = error ?? getErrorMessage(allTimeStatsResult.error, PROFILE_ERROR_FALLBACK);
  }

  // Publish the first usable scope before waiting for the other scope/history.
  await onProgress({ ...buildSummary(), isPartial: true });
  await onStage('Season and leaderboard');
  const sharedResults = await Promise.all([seasonReady, leaderboardPromise, seasonWithProgress]);
  activeSeasonId = sharedResults[0].activeSeasonId;
  leaderboard = sharedResults[1];
  const currentSeasonStatsResult = sharedResults[2];
  if (leaderboard.error !== undefined) error = error ?? leaderboard.error;
  signal.throwIfAborted();

  if (currentSeasonStatsResult !== undefined) {
    if (currentSeasonStatsResult.ok) {
      currentSeasonStats = currentSeasonStatsResult.value;
    } else if (
      currentSeasonStatsResult.error instanceof ApiRequestError &&
      currentSeasonStatsResult.error.status === 403
    ) {
      currentSeasonStatsPrivate = true;
      statsPrivate = true;
    } else {
      error = error ?? getErrorMessage(currentSeasonStatsResult.error, PROFILE_ERROR_FALLBACK);
    }
  }

  await onProgress({ ...buildSummary(), isPartial: true });

  return buildSummary();

  function buildSummary(): PlayerProfileSummary {
  const leaderboardEntry = leaderboard.ranksByDiscordId.get(player.discordId);
  const allTimeStatsSummary = buildProfileStatsSummary(allTimeStats, umaMetadata);
  const currentSeasonStatsSummary = activeSeasonId === undefined
    ? buildEmptyStatsSummary()
    : buildProfileStatsSummary(currentSeasonStats, umaMetadata);
  const displayedStats = scope === 'allTime' ? allTimeStatsSummary : currentSeasonStatsSummary;
  allTimeStatsSummary.recentHistoryStatus = allTimeStatsPrivate ? 'private' : 'unavailable';
  currentSeasonStatsSummary.recentHistoryStatus = currentSeasonStatsPrivate ? 'private' : 'unavailable';
  const fallbackRecord = getRecordFromUmaEntries(
    currentSeasonStats?.umaEntries
  );
  const wins = leaderboardEntry?.wins ?? fallbackRecord.wins ?? null;
  const losses = leaderboardEntry?.losses ?? fallbackRecord.losses ?? null;

  return {
    discordId: player.discordId,
    displayName: getPreferredDisplayName(leaderboardEntry, player),
    rank: leaderboardEntry?.rank ?? null,
    rating: leaderboardEntry?.rating ?? player.displayRatingSnapshot ?? player.ratingSnapshot ?? null,
    ratingDeviation: leaderboardEntry?.rd ?? player.displayRdSnapshot ?? player.rdSnapshot ?? null,
    conservativeRating:
      leaderboardEntry?.rating !== undefined && leaderboardEntry.rd !== undefined
        ? Math.round(leaderboardEntry.rating - leaderboardEntry.rd)
        : null,
    ...displayedStats,
    wins: scope === 'allTime' ? displayedStats.wins : wins,
    losses: scope === 'allTime' ? displayedStats.losses : losses,
    winRate: scope === 'allTime' ? displayedStats.winRate : wins !== null && losses !== null && wins + losses > 0 ? wins / (wins + losses) : displayedStats.winRate,
    statsScope: scope === 'allTime' ? 'allTime' : 'currentSeason',
    scopeFetchedAt: { ...(allTimeStats !== undefined || allTimeStatsPrivate ? { allTime: Date.now() } : {}),
      ...(currentSeasonStats !== undefined || currentSeasonStatsPrivate ? { currentSeason: Date.now() } : {}) },
    currentSeasonStats: {
      ...currentSeasonStatsSummary,
      wins,
      losses,
      winRate: wins !== null && losses !== null && wins + losses > 0 ? wins / (wins + losses) : currentSeasonStatsSummary.winRate
    },
    allTimeStats: allTimeStatsSummary,
    activeSeasonId,
    statsPrivate,
    fetchedAt: Date.now(),
    profileUrl,
    error
  };
  }
}

function getActiveSeasonId(): Promise<SeasonLookup> {
  const budget = deadline(undefined, 15_000, 'Season request timed out.');
  return abortable(fetchJson<ApiSeason[]>('/api/seasons', budget.signal, 'shared'), budget.signal)
    .then((seasons): SeasonLookup => {
      const active = seasons.find(season => season.active === true && typeof season.id === 'string');
      return {
        activeSeasonId: active?.id ?? undefined,
        ...(typeof active?.name === 'string' && active.name.trim() !== '' ? { activeSeasonName: active.name.trim() } : {})
      };
    })
    .catch((caught): SeasonLookup => ({ error: getErrorMessage(caught, PROFILE_ERROR_FALLBACK) }))
    .finally(() => budget.dispose());
}

function getActiveLeaderboard(seasonPromise: Promise<SeasonLookup>): Promise<LeaderboardLookup> {
  if (leaderboardRequest !== undefined) return leaderboardRequest;
  const budget = deadline(undefined, 15_000, 'Season/leaderboard request timed out.');
  leaderboardRequest = abortable(fetchActiveLeaderboard(seasonPromise, budget.signal), budget.signal)
    .catch((caught): LeaderboardLookup => ({ ranksByDiscordId: new Map(), error: getErrorMessage(caught, PROFILE_ERROR_FALLBACK) }))
    .finally(() => { budget.dispose(); leaderboardRequest = undefined; });
  return leaderboardRequest;
}

export async function getSeasonLeaderboard(signal: AbortSignal): Promise<SeasonLeaderboard> {
  signal.throwIfAborted();
  const lookup = await abortable(getActiveLeaderboard(getActiveSeasonId()), signal);
  signal.throwIfAborted();
  if (lookup.error || lookup.activeSeasonId === undefined) throw new Error(lookup.error ?? 'Active season unavailable.');
  return { activeSeasonId: lookup.activeSeasonId,
    ...(lookup.activeSeasonName !== undefined ? { activeSeasonName: lookup.activeSeasonName } : {}),
    entries: Array.from(lookup.ranksByDiscordId, ([userId, entry]) => ({
      rank: entry.rank, userId,
      ...(typeof entry.displayName === 'string' ? { displayName: entry.displayName } : {}),
      ...(entry.rating !== undefined ? { rating: entry.rating } : {}),
      ...(entry.rd !== undefined ? { rd: entry.rd } : {}),
      ...(entry.wins !== undefined ? { wins: entry.wins } : {}),
      ...(entry.losses !== undefined ? { losses: entry.losses } : {})
    })) };
}

async function fetchActiveLeaderboard(seasonPromise: Promise<SeasonLookup>, signal: AbortSignal): Promise<LeaderboardLookup> {
  const season = await abortable(seasonPromise, signal);
  if (season.activeSeasonId === undefined) {
    return { ranksByDiscordId: new Map(), error: season.error };
  }

  const leaderboardResult = await captureFetch(fetchJson<ApiLeaderboard>(
    `/api/leaderboard?season=${encodeURIComponent(season.activeSeasonId)}`, signal, 'leaderboard'
  ));
  const entries = leaderboardResult.ok ? leaderboardResult.value.entries ?? [] : [];

  return {
    activeSeasonId: season.activeSeasonId,
    ...(season.activeSeasonName !== undefined ? { activeSeasonName: season.activeSeasonName } : {}),
    ...(!leaderboardResult.ok ? { error: getErrorMessage(leaderboardResult.error, PROFILE_ERROR_FALLBACK) } : {}),
    ranksByDiscordId: new Map(
      entries
        .map((entry, index) =>
          entry.userId === undefined ? null : [entry.userId, { ...entry, rank: index + 1 }] as const
        )
        .filter((entry): entry is readonly [string, ApiLeaderboardEntry & { rank: number }] =>
          entry !== null
        )
    )
  };
}

function uniqueByDiscordId(players: PrematchPlayer[]): PrematchPlayer[] {
  const seen = new Set<string>();
  const uniquePlayers: PrematchPlayer[] = [];

  for (const player of players) {
    if (!isDiscordSnowflake(player.discordId)) {
      continue;
    }

    if (seen.has(player.discordId)) {
      continue;
    }

    seen.add(player.discordId);
    uniquePlayers.push(player);
  }

  return uniquePlayers;
}
