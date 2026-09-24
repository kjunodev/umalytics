import { recordDiagnostic } from '../runtime/diagnosticRecorder';
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
import type { RequestPriority } from './requestQueue';
import { browser } from 'wxt/browser';
import { releaseOrder } from '../umas/umaReleaseOrder';
import { getUmaDisplayName, getUmaPortraitUrl, normalizeUmaOutfitId } from '../umas/umaPortraits';

const API_ORIGIN = 'https://drafter-api.uma.guide';
const PROFILE_ORIGIN = 'https://drafter.uma.guide';
const SHARED_CACHE_TTL_MS = 10 * 60 * 1000;
const PROFILE_RESPONSE_TTL_MS = 24 * 60 * 60 * 1000;
const STATS_RESPONSE_TTL_MS = 60 * 1000;
const RESPONSE_CACHE_STORAGE_KEY = 'profileApiResponsesV1';
const API_RATE_LIMIT_BACKOFF_MS = 30 * 1000;
const API_SERVER_ERROR_BACKOFF_MS = 10 * 1000;
const API_REQUEST_TIMEOUT_MS = 10 * 1000;
const PROFILE_SUMMARY_TIMEOUT_MS = 60 * 1000;
const DEFAULT_REQUEST_INTERVAL_MS = 500;
let requestStartIntervalMs = DEFAULT_REQUEST_INTERVAL_MS;
const requestQueue = new RequestQueue(3, requestStartIntervalMs);


export interface ApiCooldown { until: number; status: number; path: string; startIntervalMs?: number }
let apiCooldown: ApiCooldown | undefined;
const responseCache = new Map<string, { value: unknown; expiresAt: number }>();
const inFlightRequests = new Map<string, { promise: Promise<unknown>; controller: AbortController; consumers: number }>();
let persistentCacheLoad: Promise<void> | undefined;
let persistentCacheWrites = Promise.resolve();

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

interface SeasonLookup { activeSeasonId?: string; error?: string }



interface UmaMetadata {
  label: string;
  imageUrl?: string;
}

type UmaMetadataLookup = Map<string, UmaMetadata>;

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
  const scope = options.scope ?? 'both';
  const season = getActiveSeasonId();
  const leaderboard = getActiveLeaderboard(season);
  // Enqueue every stats request before any profile request can take a paced turn.
  const allTimeRequests = uniquePlayers.map(player => scope === 'currentSeason' ? Promise.resolve(undefined) :
    captureFetch(fetchJson<ApiPlayerStats>(`/api/stats/players/${encodeURIComponent(player.discordId)}/stats?mode=ranked`, budget.signal, 'stats')));
  const seasonRequests = uniquePlayers.map(player => season.then(value =>
    scope === 'allTime' || value.activeSeasonId === undefined ? undefined :
      captureFetch(fetchJson<ApiPlayerStats>(`/api/stats/players/${encodeURIComponent(player.discordId)}/stats?mode=ranked&season=${encodeURIComponent(value.activeSeasonId)}`, budget.signal, 'stats'))));
  const profileRequests = uniquePlayers.map(player => captureFetch(fetchJson<ApiPlayerProfile>(
    `/api/stats/players/${encodeURIComponent(player.discordId)}/profile`, budget.signal, 'profile')));
  try {
    const summaries = await Promise.all(uniquePlayers.map(async (player, index) => {
      if (options.signal?.aborted) throw options.signal.reason;
      await options.onStart?.(player);
      const stage = async (value: string) => { await options.onStage?.(player, value); };
      const summary = await abortable(
        fetchPlayerProfileSummary(player, season, leaderboard, profileRequests[index]!, allTimeRequests[index]!, seasonRequests[index]!, umaMetadata, budget.signal, stage, async summary => {
          if (!options.signal?.aborted) await options.onProgress?.(summary);
        }, scope), budget.signal
      ).catch((caught) => buildUnavailablePlayerSummary(player, getErrorMessage(caught)));
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
  seasonPromise: Promise<SeasonLookup>,
  leaderboardPromise: Promise<LeaderboardLookup>,
  profileRequest: Promise<CapturedFetch<ApiPlayerProfile>>,
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
  await onStage(scope === 'currentSeason' ? 'Profile and seasonal stats' : 'Profile and all-time stats');
  let profile: ApiPlayerProfile | undefined;
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
  const baseRequests = Promise.all([
    profileRequest,
    allTimeRequest.then(async result => {
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
      error = error ?? getErrorMessage(currentSeasonStatsResult.error);
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
    activeSeasonId,
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

function getActiveSeasonId(): Promise<SeasonLookup> {
  const budget = deadline(undefined, 15_000, 'Season request timed out.');
  return abortable(fetchJson<ApiSeason[]>('/api/seasons', budget.signal, 'shared'), budget.signal)
    .then(seasons => ({ activeSeasonId: seasons.find(season => season.active === true && typeof season.id === 'string')?.id ?? undefined }))
    .catch((caught): SeasonLookup => ({ error: getErrorMessage(caught) }))
    .finally(() => budget.dispose());
}

function getActiveLeaderboard(seasonPromise: Promise<SeasonLookup>): Promise<LeaderboardLookup> {
  if (leaderboardRequest !== undefined) return leaderboardRequest;
  const budget = deadline(undefined, 15_000, 'Season/leaderboard request timed out.');
  leaderboardRequest = abortable(fetchActiveLeaderboard(seasonPromise, budget.signal), budget.signal)
    .catch((caught): LeaderboardLookup => ({ ranksByDiscordId: new Map(), error: getErrorMessage(caught) }))
    .finally(() => { budget.dispose(); leaderboardRequest = undefined; });
  return leaderboardRequest;
}

async function fetchActiveLeaderboard(seasonPromise: Promise<SeasonLookup>, signal: AbortSignal): Promise<LeaderboardLookup> {
  const season = await abortable(seasonPromise, signal);
  if (season.activeSeasonId === undefined) {
    return { ranksByDiscordId: new Map(), error: season.error };
  }

  const leaderboardResult = await captureFetch(fetchJson<ApiLeaderboard>(
    `/api/leaderboard?season=${encodeURIComponent(season.activeSeasonId)}`, signal, 'shared'
  ));
  const entries = leaderboardResult.ok ? leaderboardResult.value.entries ?? [] : [];

  return {
    activeSeasonId: season.activeSeasonId,
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

function cacheTtl(path: string): number {
  if (path === '/api/seasons' || path.startsWith('/api/leaderboard?')) return SHARED_CACHE_TTL_MS;
  if (path.endsWith('/profile')) return PROFILE_RESPONSE_TTL_MS;
  return STATS_RESPONSE_TTL_MS;
}

function isPersistentResponse(path: string): boolean {
  return path === '/api/seasons' || path.startsWith('/api/leaderboard?') || path.endsWith('/profile');
}

function loadPersistentResponses(): Promise<void> {
  return persistentCacheLoad ??= (async () => {
    if (typeof browser === 'undefined' || browser.storage?.session === undefined) return;
    try {
      const stored = await browser.storage.session.get(RESPONSE_CACHE_STORAGE_KEY);
      const entries = stored[RESPONSE_CACHE_STORAGE_KEY] as Record<string, { value: unknown; expiresAt: number }> | undefined;
      for (const [path, entry] of Object.entries(entries ?? {})) {
        if (!isPersistentResponse(path) || !Number.isFinite(entry?.expiresAt) || entry.expiresAt <= Date.now()) continue;
        if ((responseCache.get(path)?.expiresAt ?? 0) < entry.expiresAt) responseCache.set(path, entry);
      }
    } catch { /* Session storage can be unavailable; the memory cache still works. */ }
  })();
}

function persistResponses(): Promise<void> {
  if (typeof browser === 'undefined' || browser.storage?.session === undefined) return Promise.resolve();
  const entries = [...responseCache].filter(([path, entry]) => isPersistentResponse(path) && entry.expiresAt > Date.now())
    .sort((a, b) => b[1].expiresAt - a[1].expiresAt);
  const shared = entries.filter(([path]) => !path.endsWith('/profile'));
  const profiles = entries.filter(([path]) => path.endsWith('/profile')).slice(0, 200);
  const snapshot = Object.fromEntries([...shared, ...profiles]);
  persistentCacheWrites = persistentCacheWrites.then(() => browser.storage.session.set({ [RESPONSE_CACHE_STORAGE_KEY]: snapshot })).catch(() => {});
  return persistentCacheWrites;
}

export async function fetchJson<T>(path: string, signal?: AbortSignal, priority: RequestPriority = 'background'): Promise<T> {
  signal?.throwIfAborted();
  let shared = inFlightRequests.get(path);
  if (shared === undefined) {
    const controller = new AbortController();
    const promise = fetchJsonOnce<T>(path, controller.signal, priority).finally(() => inFlightRequests.delete(path));
    shared = { promise, controller, consumers: 0 };
    inFlightRequests.set(path, shared);
  }
  shared.consumers += 1;
  const budget = deadline(signal, PROFILE_SUMMARY_TIMEOUT_MS, `Request queue timed out: ${path}`);
  try {
    return await abortable(shared.promise as Promise<T>, budget.signal);
  } finally {
    budget.dispose();
    shared.consumers -= 1;
    if (shared.consumers === 0) shared.controller.abort(new Error('Request cancelled.'));
  }
}

async function fetchJsonOnce<T>(path: string, signal: AbortSignal, priority: RequestPriority): Promise<T> {
  await loadPersistentResponses();
  signal.throwIfAborted();
  const endpoint = path.split('?')[0]!.split('/').at(-1);
  const cached = responseCache.get(path);
  if (cached !== undefined && cached.expiresAt > Date.now()) { recordDiagnostic({ kind: 'cache', endpoint, reason: 'hit' }); return cached.value as T; }
  assertApiAvailable(path);
  const queuedAt = Date.now();
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
      if (responseCache.size >= 256) responseCache.delete(responseCache.keys().next().value!);
      responseCache.set(path, { value, expiresAt: Date.now() + cacheTtl(path) });
      if (isPersistentResponse(path)) await persistResponses();
      return value;
      } catch (error) {
        if (!(error instanceof ApiRequestError)) recordDiagnostic({ kind: 'request', endpoint,
          reason: signal?.aborted ? 'cancelled' : /timed out/i.test(getErrorMessage(error)) ? 'timeout' : 'network-error', queueMs: startedAt - queuedAt, networkMs: Date.now() - startedAt });
        throw error;
      } finally { budget.dispose(); }
    }, priority);
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
