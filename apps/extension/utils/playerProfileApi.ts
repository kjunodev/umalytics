import { recordDiagnostic } from './diagnosticRecorder';
import type {
  PlayerRecentFormSummary,
  PlayerRecentMatchSummary,
  PlayerProfileStatsSummary,
  PlayerProfileSummary,
  PlayerTopUmaSummary,
  PrematchPlayer
} from '@umalytics/shared';
import {
  BEST_UMA_MIN_MATCHES,
  BEST_UMA_SCORE_VERSION,
  RECENT_HISTORY_ANALYSIS_MATCHES,
  RECENT_HISTORY_VERSION
} from './profileConstants';
import { abortable, deadline, RequestQueue } from './requestQueue';
import { releaseOrder } from './umaReleaseOrder';
import { getUmaDisplayName, getUmaPortraitUrl, normalizeUmaOutfitId } from './umaPortraits';

const API_ORIGIN = 'https://drafter-api.uma.guide';
const PROFILE_ORIGIN = 'https://drafter.uma.guide';
const SHARED_CACHE_TTL_MS = 60 * 1000;
const API_RATE_LIMIT_BACKOFF_MS = 30 * 1000;
const API_SERVER_ERROR_BACKOFF_MS = 10 * 1000;
const API_REQUEST_TIMEOUT_MS = 10 * 1000;
const PROFILE_SUMMARY_TIMEOUT_MS = 60 * 1000;
const PROFILE_FETCH_CONCURRENCY = 4;
const DEFAULT_REQUEST_INTERVAL_MS = 500;
let requestStartIntervalMs = DEFAULT_REQUEST_INTERVAL_MS;
const requestQueue = new RequestQueue(3, requestStartIntervalMs);


export interface ApiCooldown { until: number; status: number; path: string; startIntervalMs?: number }
let apiCooldown: ApiCooldown | undefined;
const responseCache = new Map<string, { value: unknown; expiresAt: number }>();

export function getApiCooldown(): ApiCooldown | undefined { return apiCooldown; }
export function restoreApiCooldown(value: ApiCooldown): void {
  if (value.until > (apiCooldown?.until ?? 0)) apiCooldown = value;
  requestStartIntervalMs = Math.max(requestStartIntervalMs, Math.min(2000, value.startIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS));
  requestQueue.setStartInterval(requestStartIntervalMs);
}


interface ApiPlayerProfile {
  displayName?: string;
  discordUsername?: string;
  nickname?: string | null;
  title?: string | null;
}

interface ApiPlayerStats {
  umaEntries?: ApiUmaEntry[];
  summary?: {
    matchesIncluded?: number;
    totalPointsScored?: number;
    totalPodiumPlacements?: number;
    totalMvpMatches?: number;
  };
}

type CapturedFetch<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

interface ApiUmaEntry {
  umaId?: string | null;
  matches?: number;
  wins?: number;
  losses?: number;
  pointsScored?: number;
  podiumPlacements?: number;
  mvpMatches?: number;
}

interface ApiSeason {
  id?: string | null;
  active?: boolean;
}

interface ApiLeaderboard {
  entries?: ApiLeaderboardEntry[];
}

interface ApiLeaderboardEntry {
  userId?: string;
  displayName?: string | null;
  rating?: number;
  rd?: number;
  wins?: number;
  losses?: number;
}

interface LeaderboardLookup {
  error?: string;
  ranksByDiscordId: Map<string, ApiLeaderboardEntry & { rank: number }>;
  activeSeasonId?: string;
}



interface UmaMetadata {
  label: string;
  imageUrl?: string;
}

type UmaMetadataLookup = Map<string, UmaMetadata>;

let cachedLeaderboard: { value: LeaderboardLookup; expiresAt: number } | undefined;
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
  } = {}
): Promise<Record<string, PlayerProfileSummary>> {
  const uniquePlayers = uniqueByDiscordId(players);
  if (uniquePlayers.length === 0) return {};
  // The roster deadline starts before shared setup or the profile queue.
  const budget = deadline(options.signal, PROFILE_SUMMARY_TIMEOUT_MS, 'Profile loading timed out (including queue).');
  const umaMetadata = bundledUmaMetadata ??= buildReleaseOrderUmaMetadata();
  const leaderboard = getActiveLeaderboard();
  try {
    const summaries = await mapWithConcurrency(uniquePlayers, PROFILE_FETCH_CONCURRENCY, async (player) => {
      if (options.signal?.aborted) throw options.signal.reason;
      await options.onStart?.(player);
      const stage = async (value: string) => { await options.onStage?.(player, value); };
      const summary = await abortable(
        fetchPlayerProfileSummary(player, leaderboard, umaMetadata, budget.signal, stage, async summary => {
          if (!options.signal?.aborted) await options.onProgress?.(summary);
        }, options.scope ?? 'both'), budget.signal
      ).catch((caught) => buildUnavailablePlayerSummary(player, getErrorMessage(caught)));
      if (!options.signal?.aborted) await options.onSummary?.(summary);
      return summary;
    });
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
    recentForm: buildRecentFormSummary([]),
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

async function fetchPlayerProfileSummary(
  player: PrematchPlayer,
  leaderboardPromise: Promise<LeaderboardLookup>,
  umaMetadata: UmaMetadataLookup,
  signal: AbortSignal,
  onStage: (stage: string) => Promise<void>,
  onProgress: (summary: PlayerProfileSummary) => Promise<void>,
  scope: 'currentSeason' | 'allTime' | 'both'
): Promise<PlayerProfileSummary> {
  const profileUrl = `${PROFILE_ORIGIN}/players/${encodeURIComponent(player.discordId)}`;
  signal.throwIfAborted();
  await onStage(scope === 'currentSeason' ? 'Profile and seasonal stats' : 'Profile and all-time stats');
  const profilePath = `/api/stats/players/${encodeURIComponent(player.discordId)}/profile`;
  const allTimeStatsPath = `/api/stats/players/${encodeURIComponent(player.discordId)}/stats?mode=ranked`;
  let profile: ApiPlayerProfile | undefined;
  let allTimeStats: ApiPlayerStats | undefined;
  let currentSeasonStats: ApiPlayerStats | undefined;
  let allTimeStatsPrivate = false;
  let currentSeasonStatsPrivate = false;
  let statsPrivate = false;
  let error: string | undefined;
  let leaderboard: LeaderboardLookup = { ranksByDiscordId: new Map() };

  // Begin usable player data immediately; season/leaderboard setup runs alongside it.
  const baseRequests = Promise.all([
    captureFetch(fetchJson<ApiPlayerProfile>(profilePath, signal)),
    (scope === 'currentSeason' ? Promise.resolve(undefined) : captureFetch(fetchJson<ApiPlayerStats>(allTimeStatsPath, signal))).then(async result => {
      if (result === undefined) return undefined;
      if (result.ok) allTimeStats = result.value;
      else if (result.error instanceof ApiRequestError && result.error.status === 403) {
        allTimeStatsPrivate = true;
        statsPrivate = true;
      }
      signal.throwIfAborted();
      if (result.ok || allTimeStatsPrivate) await onProgress({ ...buildSummary(), isPartial: true });
      return result;
    })
  ]);
  const seasonRequest = leaderboardPromise.then(async (leaderboard) => {
    if (scope === 'allTime' || leaderboard.activeSeasonId === undefined) return undefined;
    return captureFetch(fetchJson<ApiPlayerStats>(
      `/api/stats/players/${encodeURIComponent(player.discordId)}/stats?mode=ranked&season=${encodeURIComponent(leaderboard.activeSeasonId)}`, signal));
  });
  const [profileResult, allTimeStatsResult] = await baseRequests;
  signal.throwIfAborted();
  if (profileResult.ok) {
    profile = profileResult.value;
  } else {
    error = getErrorMessage(profileResult.error);
  }

  if (allTimeStatsResult?.ok) {
    allTimeStats = allTimeStatsResult.value;
  } else if (allTimeStatsResult !== undefined && allTimeStatsResult.error instanceof ApiRequestError && allTimeStatsResult.error.status === 403) {
    allTimeStatsPrivate = true;
    statsPrivate = true;
  } else {
    if (allTimeStatsResult !== undefined) error = error ?? getErrorMessage(allTimeStatsResult.error);
  }

  // Publish the first usable scope before waiting for the other scope/history.
  await onProgress({ ...buildSummary(), isPartial: true });
  await onStage('Season and leaderboard');
  const sharedResults = await Promise.all([leaderboardPromise, seasonRequest]);
  leaderboard = sharedResults[0];
  const currentSeasonStatsResult = sharedResults[1];
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
      error = error ?? getErrorMessage(currentSeasonStatsResult.error);
    }
  }

  await onProgress({ ...buildSummary(), isPartial: true });

  return buildSummary();

  function buildSummary(): PlayerProfileSummary {
  const leaderboardEntry = leaderboard.ranksByDiscordId.get(player.discordId);
  const allTimeStatsSummary = buildProfileStatsSummary(allTimeStats, umaMetadata);
  const currentSeasonStatsSummary = leaderboard.activeSeasonId === undefined
    ? buildEmptyStatsSummary()
    : buildProfileStatsSummary(currentSeasonStats, umaMetadata);
  const displayedStats = scope === 'allTime' ? allTimeStatsSummary : currentSeasonStatsSummary;
  const fallbackRecord = getRecordFromUmaEntries(
    currentSeasonStats?.umaEntries
  );
  const wins = leaderboardEntry?.wins ?? fallbackRecord.wins ?? null;
  const losses = leaderboardEntry?.losses ?? fallbackRecord.losses ?? null;

  return {
    discordId: player.discordId,
    displayName: getPreferredDisplayName(profile, leaderboardEntry, player),
    discordUsername: profile?.discordUsername,
    title: profile?.title ?? null,
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
    historyDerived: false,
    currentSeasonStats: {
      ...currentSeasonStatsSummary,
      wins,
      losses,
      winRate: wins !== null && losses !== null && wins + losses > 0 ? wins / (wins + losses) : currentSeasonStatsSummary.winRate
    },
    allTimeStats: allTimeStatsSummary,
    activeSeasonId: leaderboard.activeSeasonId,
    statsPrivate,
    fetchedAt: Date.now(),
    profileUrl,
    error
  };
  }
}

function getPreferredDisplayName(
  profile: ApiPlayerProfile | undefined,
  leaderboardEntry: ApiLeaderboardEntry | undefined,
  player: PrematchPlayer
): string {
  return [
    profile?.displayName,
    profile?.nickname,
    profile?.discordUsername,
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

function buildReleaseOrderUmaMetadata(): UmaMetadataLookup {
  return new Map(
    releaseOrder.map((entry) => {
      const label = getUmaDisplayName(entry.outfitId, entry.name);
      const imageUrl = getUmaPortraitUrl(entry.outfitId, PROFILE_ORIGIN);
      const metadata: UmaMetadata = imageUrl === undefined ? { label } : { label, imageUrl };

      return [entry.outfitId, metadata] as const;
    })
  );
}

function getActiveLeaderboard(): Promise<LeaderboardLookup> {
  if (cachedLeaderboard !== undefined && cachedLeaderboard.expiresAt > Date.now()) {
    return Promise.resolve(cachedLeaderboard.value);
  }
  if (leaderboardRequest !== undefined) return leaderboardRequest;
  const budget = deadline(undefined, 15_000, 'Season/leaderboard request timed out.');
  leaderboardRequest = abortable(fetchActiveLeaderboard(budget.signal), budget.signal)
    .then((value) => {
      if (value.error === undefined) cachedLeaderboard = { value, expiresAt: Date.now() + SHARED_CACHE_TTL_MS };
      return value;
    }).catch((caught): LeaderboardLookup => ({ ranksByDiscordId: new Map(), error: getErrorMessage(caught) }))
    .finally(() => { budget.dispose(); leaderboardRequest = undefined; });
  return leaderboardRequest;
}

async function fetchActiveLeaderboard(signal: AbortSignal): Promise<LeaderboardLookup> {
  const seasons = await fetchJson<ApiSeason[]>('/api/seasons', signal);
  const activeSeason = seasons.find((season) => season.active === true && typeof season.id === 'string');

  if (typeof activeSeason?.id !== 'string') {
    return { ranksByDiscordId: new Map() };
  }

  const leaderboardResult = await captureFetch(fetchJson<ApiLeaderboard>(
    `/api/leaderboard?season=${encodeURIComponent(activeSeason.id)}`, signal
  ));
  const entries = leaderboardResult.ok ? leaderboardResult.value.entries ?? [] : [];

  return {
    activeSeasonId: activeSeason.id,
    ...(!leaderboardResult.ok ? { error: getErrorMessage(leaderboardResult.error) } : {}),
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
    recentForm: buildRecentFormSummary(recentMatches.slice(0, RECENT_HISTORY_ANALYSIS_MATCHES)),
    unresolvedUmaMatches: resolutionSummary.unresolvedUmaMatches,
    disqualifiedMatches: resolutionSummary.disqualifiedMatches,
    bestUmaScoreVersion: BEST_UMA_SCORE_VERSION,
    recentHistoryVersion: RECENT_HISTORY_VERSION
  };
}

function buildProfileStatsSummary(stats: ApiPlayerStats | undefined, umaMetadata: UmaMetadataLookup): PlayerProfileStatsSummary {
  return stats === undefined ? buildEmptyStatsSummary() : buildStatsSummary(stats, umaMetadata);
}

function buildEmptyStatsSummary(

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
    recentForm: buildRecentFormSummary(recentMatches.slice(0, RECENT_HISTORY_ANALYSIS_MATCHES)),
    unresolvedUmaMatches: resolutionSummary.unresolvedUmaMatches,
    disqualifiedMatches: resolutionSummary.disqualifiedMatches,
    bestUmaScoreVersion: BEST_UMA_SCORE_VERSION,
    recentHistoryVersion: RECENT_HISTORY_VERSION
  };
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const cached = responseCache.get(path);
  if (cached !== undefined && cached.expiresAt > Date.now()) { recordDiagnostic({ kind: 'cache', reason: 'hit' }); return cached.value as T; }
  assertApiAvailable(path);
  const queuedAt = Date.now();
  const endpoint = path.split('?')[0]!.split('/').at(-1);
  const queueBudget = deadline(signal, PROFILE_SUMMARY_TIMEOUT_MS, `Request queue timed out: ${path}`);
  try {
    return await requestQueue.run(queueBudget.signal, async () => {
      const startedAt = Date.now();
      const budget = deadline(queueBudget.signal, API_REQUEST_TIMEOUT_MS, `Request timed out: ${path}`);
      try {
      // Do not hold profiles in an invisible sleep, or retry a rate-limited API in a burst.
      assertApiAvailable(path);
      const response = await fetch(new URL(path, API_ORIGIN), {
        cache: 'no-store', credentials: 'omit', signal: budget.signal
      });
      if (!response.ok) {
        recordDiagnostic({ kind: 'request', endpoint, reason: 'http-error', status: response.status, queueMs: startedAt - queuedAt, networkMs: Date.now() - startedAt });
        // Release an error response body without keeping a connection occupied.
        void response.body?.cancel().catch(() => undefined);
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = response.headers.get('retry-after');
          const seconds = retryAfter === null ? NaN : Number(retryAfter);
          const dateMs = retryAfter === null ? NaN : Date.parse(retryAfter);
          const delayMs = Number.isFinite(seconds) ? seconds * 1000
            : Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now())
            : response.status === 429 ? API_RATE_LIMIT_BACKOFF_MS : API_SERVER_ERROR_BACKOFF_MS;
          restoreApiCooldown({ until: Date.now() + Math.max(1000, delayMs), status: response.status, path,
            startIntervalMs: response.status === 429 ? Math.min(2000, requestStartIntervalMs * 2) : requestStartIntervalMs });
        }
        throw new ApiRequestError(response.status, `Request failed (HTTP ${response.status}): ${path}`);
      }
      const value = await response.json() as T;
      budget.signal.throwIfAborted();
      recordDiagnostic({ kind: 'request', endpoint, reason: 'success', status: response.status, queueMs: startedAt - queuedAt, networkMs: Date.now() - startedAt });
      // Cache successes only, so a partial retry does not re-download healthy endpoints.
      for (const [key, entry] of responseCache) if (entry.expiresAt <= Date.now()) responseCache.delete(key);
      if (responseCache.size >= 128) responseCache.delete(responseCache.keys().next().value!);
      responseCache.set(path, { value, expiresAt: Date.now() + SHARED_CACHE_TTL_MS });
      return value;
      } catch (error) {
        if (!(error instanceof ApiRequestError)) recordDiagnostic({ kind: 'request', endpoint,
          reason: signal?.aborted ? 'cancelled' : /timed out/i.test(getErrorMessage(error)) ? 'timeout' : 'network-error', queueMs: startedAt - queuedAt, networkMs: Date.now() - startedAt });
        throw error;
      } finally { budget.dispose(); }
    });
  } finally {
    queueBudget.dispose();
  }
}

function assertApiAvailable(path: string): void {
  if (apiCooldown !== undefined && apiCooldown.until > Date.now()) {
    throw new Error(`API paused after HTTP ${apiCooldown.status} at ${apiCooldown.path}; retry after ${new Date(apiCooldown.until).toISOString()}. Pending: ${path}`);
  }
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

function isDiscordSnowflake(value: string): boolean {
  return /^\d{16,20}$/.test(value);
}

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];

      if (item !== undefined) {
        results[currentIndex] = await mapper(item);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
}

function getRecordFromUmaEntries(
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
  const podiumRate = matches > 0 ? podiums / (matches * 3) : null;

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
  const normalizedPpg = Math.min((pointsPerGame ?? 0) / 8, 1);
  const normalizedWinRate = winRate ?? 0;
  const normalizedPodiumRate = podiumRate ?? 0;

  return Math.round((normalizedPpg * 0.7 + normalizedWinRate * 0.2 + normalizedPodiumRate * 0.1) * 100);
}

function buildRecentFormSummary(recentMatches: PlayerRecentMatchSummary[]): PlayerRecentFormSummary {
  const confirmedMatches = recentMatches.filter((match) => match.verificationState === 'confirmed');
  const matches = confirmedMatches.length;
  const scoredMatches = confirmedMatches.filter((match) => match.pointsScored > 0).length;
  const wins = confirmedMatches.filter((match) => match.isWinner === true).length;
  const points = confirmedMatches.reduce((total, match) => total + match.pointsScored, 0);
  const podiums = confirmedMatches.reduce((total, match) => total + match.podiums, 0);
  const mvpMatches = confirmedMatches.filter((match) => match.isMvp).length;

  return {
    matches,
    scoredMatches,
    scoringRate: matches > 0 ? scoredMatches / matches : null,
    wins,
    winRate: matches > 0 ? wins / matches : null,
    points,
    pointsPerGame: matches > 0 ? points / matches : null,
    podiums,
    mvpMatches
  };
}

function addNullable(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

function getErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'Unable to load profile.';
}

class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}
