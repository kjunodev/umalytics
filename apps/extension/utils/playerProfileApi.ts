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
import { releaseOrder } from './umaReleaseOrder';
import { getUmaPortraitUrl } from './umaPortraits';

const API_ORIGIN = 'https://drafter-api.uma.guide';
const PROFILE_ORIGIN = 'https://drafter.uma.guide';
const UMA_LABEL_CACHE_TTL_MS = 60 * 60 * 1000;
const API_RATE_LIMIT_BACKOFF_MS = 30 * 1000;
const API_SERVER_ERROR_BACKOFF_MS = 10 * 1000;

let apiBackoffUntil = 0;
const RELEASE_VARIANTS_BY_OUTFIT_ID = new Map(
  releaseOrder.map((entry) => [entry.outfitId, entry.variant.trim()] as const)
);

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

interface ApiPlayerHistory {
  playerHistory?: ApiPlayerHistoryEntry[];
}

interface ApiPlayerHistoryEntry {
  matchId?: string;
  mode?: string;
  verificationState?: string;
  reportedAt?: string;
  selectedUmaId?: string;
  isWinner?: boolean;
  pointsScored?: number;
  podiumPlacements?: number;
  isMvp?: boolean;
  eloDelta?: number | null;
}

interface ApiUmaEntry {
  umaId?: string;
  matches?: number;
  wins?: number;
  losses?: number;
  pointsScored?: number;
  podiumPlacements?: number;
  mvpMatches?: number;
}

interface ApiSeason {
  id?: string;
  active?: boolean;
}

interface ApiLeaderboard {
  entries?: ApiLeaderboardEntry[];
}

interface ApiLeaderboardEntry {
  userId?: string;
  displayName?: string;
  rating?: number;
  rd?: number;
  wins?: number;
  losses?: number;
}

interface LeaderboardLookup {
  ranksByDiscordId: Map<string, ApiLeaderboardEntry & { rank: number }>;
  activeSeasonId?: string;
}

interface UmaCard {
  cardId?: number | string;
  charaId?: number | string;
  name?: string;
  charaName?: string;
  title?: string;
  cardTitle?: string;
  [key: string]: unknown;
}

interface UmaMetadata {
  label: string;
  imageUrl?: string;
}

type UmaMetadataLookup = Map<string, UmaMetadata>;

let cachedUmaMetadata:
  | {
      metadataById: UmaMetadataLookup;
      fetchedAt: number;
    }
  | undefined;

export async function fetchPlayerProfileSummaries(
  players: PrematchPlayer[]
): Promise<Record<string, PlayerProfileSummary>> {
  const [leaderboard, umaMetadata] = await Promise.all([
    fetchActiveLeaderboard().catch((caught) => {
      console.warn('[UmaLytics] Unable to load active leaderboard:', caught);
      return { ranksByDiscordId: new Map() } satisfies LeaderboardLookup;
    }),
    fetchUmaMetadata()
  ]);
  const uniquePlayers = uniqueByDiscordId(players);
  const summaries = await mapWithConcurrency(uniquePlayers, 3, async (player) =>
    fetchPlayerProfileSummary(player, leaderboard, umaMetadata).catch((caught) =>
      buildUnavailablePlayerSummary(player, getErrorMessage(caught))
    )
  );

  return Object.fromEntries(summaries.map((summary) => [summary.discordId, summary]));
}

function buildUnavailablePlayerSummary(
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

async function fetchPlayerProfileSummary(
  player: PrematchPlayer,
  leaderboard: LeaderboardLookup,
  umaMetadata: UmaMetadataLookup
): Promise<PlayerProfileSummary> {
  const profileUrl = `${PROFILE_ORIGIN}/players/${encodeURIComponent(player.discordId)}`;
  const leaderboardEntry = leaderboard.ranksByDiscordId.get(player.discordId);
  let profile: ApiPlayerProfile | undefined;
  let allTimeStats: ApiPlayerStats | undefined;
  let currentSeasonStats: ApiPlayerStats | undefined;
  let allTimeHistory: ApiPlayerHistory | undefined;
  let statsPrivate = false;
  let error: string | undefined;

  try {
    profile = await fetchJson<ApiPlayerProfile>(
      `/api/stats/players/${encodeURIComponent(player.discordId)}/profile`
    );
  } catch (caught) {
    error = getErrorMessage(caught);
  }

  try {
    allTimeStats = await fetchJson<ApiPlayerStats>(
      `/api/stats/players/${encodeURIComponent(player.discordId)}/stats?mode=ranked`
    );
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 403) {
      statsPrivate = true;
    } else {
      error = error ?? getErrorMessage(caught);
    }
  }

  try {
    allTimeHistory = await fetchPlayerHistory(player.discordId);
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 403) {
      statsPrivate = true;
    } else {
      console.warn('[UmaLytics] Unable to load recent match history:', caught);
    }
  }

  if (leaderboard.activeSeasonId !== undefined) {
    try {
      currentSeasonStats = await fetchJson<ApiPlayerStats>(
        `/api/stats/players/${encodeURIComponent(player.discordId)}/stats?mode=ranked&season=${encodeURIComponent(leaderboard.activeSeasonId)}`
      );
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 403) {
        statsPrivate = true;
      } else {
        console.warn('[UmaLytics] Unable to load current season stats:', caught);
      }
    }
  }

  const allTimeStatsSummary = buildStatsSummary(allTimeStats, umaMetadata, allTimeHistory);
  const currentSeasonStatsSummary = currentSeasonStats === undefined
    ? allTimeStatsSummary
    : buildStatsSummary(currentSeasonStats, umaMetadata, allTimeHistory);
  const displayedStats = currentSeasonStatsSummary;
  const fallbackRecord = getRecordFromUmaEntries(currentSeasonStats?.umaEntries ?? allTimeStats?.umaEntries);
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
    wins,
    losses,
    winRate: wins !== null && losses !== null && wins + losses > 0 ? wins / (wins + losses) : displayedStats.winRate,
    statsScope: 'currentSeason',
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

function getUsableDisplayName(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
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

async function fetchUmaMetadata(): Promise<UmaMetadataLookup> {
  const now = Date.now();

  if (cachedUmaMetadata !== undefined && now - cachedUmaMetadata.fetchedAt < UMA_LABEL_CACHE_TTL_MS) {
    return cachedUmaMetadata.metadataById;
  }

  try {
    const cardsAssetUrl = await fetchCardsAssetUrl();
    const script = await fetchText(cardsAssetUrl);
    const cards = parseUmaCards(script);
    const metadataById: UmaMetadataLookup = new Map();

    for (const card of cards) {
      const id = card.cardId;

      if (id === undefined) {
        continue;
      }

      const cardId = String(id);
      const imageUrl = extractUmaImageUrl(card);
      const metadata: UmaMetadata = imageUrl === undefined
        ? { label: formatUmaLabel(card) }
        : { label: formatUmaLabel(card), imageUrl };

      metadataById.set(cardId, metadata);
    }

    cachedUmaMetadata = {
      metadataById,
      fetchedAt: now
    };

    return metadataById;
  } catch (caught) {
    console.warn('[UmaLytics] Unable to load Uma metadata:', caught);
    return cachedUmaMetadata?.metadataById ?? new Map();
  }
}

async function fetchPlayerHistory(discordId: string): Promise<ApiPlayerHistory> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(RECENT_HISTORY_ANALYSIS_MATCHES),
    mode: 'ranked'
  });

  return await fetchJson<ApiPlayerHistory>(
    `/api/stats/players/${encodeURIComponent(discordId)}/history?${params.toString()}`
  );
}

async function fetchCardsAssetUrl(): Promise<URL> {
  const html = await fetchText(new URL('/', PROFILE_ORIGIN));
  const directCardsMatch = /["'](\/assets\/cards-[^"']+\.js)["']/.exec(html);

  if (directCardsMatch?.[1] !== undefined) {
    return new URL(directCardsMatch[1], PROFILE_ORIGIN);
  }

  const indexMatch = /<script[^>]+src=["'](\/assets\/index-[^"']+\.js)["'][^>]*>/i.exec(html);

  if (indexMatch?.[1] === undefined) {
    throw new Error('Unable to find Uma Drafter index asset.');
  }

  const indexScript = await fetchText(new URL(indexMatch[1], PROFILE_ORIGIN));
  const indirectCardsMatch = /["'](?:\.\/)?(assets\/cards-[^"']+\.js)["']/.exec(indexScript);

  if (indirectCardsMatch?.[1] === undefined) {
    throw new Error('Unable to find Uma card labels asset.');
  }

  return new URL(`/${indirectCardsMatch[1]}`, PROFILE_ORIGIN);
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetch(url, {
    cache: 'force-cache',
    credentials: 'omit'
  });

  if (!response.ok) {
    throw new ApiRequestError(response.status, `Request failed: ${response.status}`);
  }

  return await response.text();
}

function parseUmaCards(script: string): UmaCard[] {
  const match = /JSON\.parse\(`([\s\S]*?)`\)/.exec(script);

  if (match?.[1] === undefined) {
    return [];
  }

  return JSON.parse(match[1]) as UmaCard[];
}

function extractUmaImageUrl(card: UmaCard): string | undefined {
  const cardId = getCardIdString(card);

  if (cardId !== undefined && getCharaIdString(card) !== undefined) {
    return getUmaPortraitUrl(cardId, PROFILE_ORIGIN);
  }

  return undefined;
}

function formatUmaLabel(card: UmaCard): string {
  const name = getUmaCharacterName(card) ?? String(card.cardId);
  const cardId = getCardIdString(card);
  const releaseVariant = cardId === undefined
    ? undefined
    : normalizeReleaseVariant(RELEASE_VARIANTS_BY_OUTFIT_ID.get(cardId));

  if (releaseVariant !== undefined) {
    return releaseVariant.length === 0 ? name : `${releaseVariant} ${name}`;
  }

  if (isLikelyBaseUmaCard(card)) {
    return name;
  }

  const title = card.title ?? card.cardTitle;
  const cleanTitle = cleanUmaCardTitle(title);
  const draftStylePrefix = getDraftStyleTitlePrefix(cleanTitle);

  if (draftStylePrefix !== undefined) {
    return `${draftStylePrefix} ${name}`;
  }

  return name;
}

function getUmaCharacterName(card: UmaCard): string | undefined {
  return getNonEmptyString(card.name) ?? getNonEmptyString(card.charaName);
}

function normalizeReleaseVariant(variant: string | undefined): string | undefined {
  if (variant === undefined) {
    return undefined;
  }

  return variant;
}

function getCardIdString(card: UmaCard): string | undefined {
  if (card.cardId === undefined) {
    return undefined;
  }

  return String(card.cardId);
}

function getCharaIdString(card: UmaCard): string | undefined {
  if (card.charaId === undefined) {
    return undefined;
  }

  return String(card.charaId);
}

function getNumericCardId(card: UmaCard): number | undefined {
  const cardIdString = getCardIdString(card);

  if (cardIdString === undefined) {
    return undefined;
  }

  const cardId = Number(cardIdString);
  return Number.isFinite(cardId) ? cardId : undefined;
}

function isLikelyBaseUmaCard(card: UmaCard): boolean {
  const cardId = getNumericCardId(card);

  return cardId !== undefined && cardId % 100 === 1;
}

function cleanUmaCardTitle(title: string | undefined): string | undefined {
  const cleanTitle = getNonEmptyString(title)
    ?.trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/[☆★♪!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleanTitle === undefined || cleanTitle.length === 0 ? undefined : cleanTitle;
}

function getNonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function getDraftStyleTitlePrefix(title: string | undefined): string | undefined {
  if (title === undefined || title.length === 0) {
    return undefined;
  }

  const normalizedTitle = title.toLowerCase();
  const compactPrefixes: Array<readonly [RegExp, string]> = [
    [/\bcamping?\b/, 'Camping'],
    [/\bsummer\b/, 'Summer'],
    [/\bchristmas\b/, 'Christmas'],
    [/\bvalentines?\b/, 'Valentine'],
    [/\bwedding\b/, 'Wedding'],
    [/\bhalloween\b/, 'Halloween'],
    [/\bnew year\b/, 'New Year']
  ];

  for (const [pattern, prefix] of compactPrefixes) {
    if (pattern.test(normalizedTitle)) {
      return prefix;
    }
  }

  return title;
}

async function fetchActiveLeaderboard(): Promise<LeaderboardLookup> {
  const seasons = await fetchJson<ApiSeason[]>('/api/seasons');
  const activeSeason = seasons.find((season) => season.active === true && season.id !== undefined);

  if (activeSeason?.id === undefined) {
    return { ranksByDiscordId: new Map() };
  }

  const leaderboard = await fetchJson<ApiLeaderboard>(
    `/api/leaderboard?season=${encodeURIComponent(activeSeason.id)}`
  );
  const entries = leaderboard.entries ?? [];

  return {
    activeSeasonId: activeSeason.id,
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
  umaMetadata: UmaMetadataLookup,
  history?: ApiPlayerHistory
): PlayerProfileStatsSummary {
  if (stats === undefined) {
    return buildEmptyStatsSummary(history, umaMetadata);
  }

  const record = getRecordFromUmaEntries(stats.umaEntries);
  const wins = record.wins;
  const losses = record.losses;
  const matches = stats.summary?.matchesIncluded ?? addNullable(wins, losses);
  const points = stats.summary?.totalPointsScored;
  const recentMatches = buildRecentMatchSummaries(history?.playerHistory, umaMetadata);

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
    recentForm: buildRecentFormSummary(recentMatches),
    bestUmaScoreVersion: BEST_UMA_SCORE_VERSION,
    recentHistoryVersion: RECENT_HISTORY_VERSION
  };
}

function buildEmptyStatsSummary(
  history?: ApiPlayerHistory,
  umaMetadata: UmaMetadataLookup = new Map()
): PlayerProfileStatsSummary {
  const recentMatches = buildRecentMatchSummaries(history?.playerHistory, umaMetadata);

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
    recentForm: buildRecentFormSummary(recentMatches),
    bestUmaScoreVersion: BEST_UMA_SCORE_VERSION,
    recentHistoryVersion: RECENT_HISTORY_VERSION
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  await waitForApiBackoff();

  const response = await fetch(new URL(path, API_ORIGIN), {
    cache: 'no-store',
    credentials: 'omit'
  });

  if (!response.ok) {
    registerApiBackoff(response);
    throw new ApiRequestError(response.status, `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function waitForApiBackoff(): Promise<void> {
  const waitMs = apiBackoffUntil - Date.now();

  if (waitMs > 0) {
    await delay(waitMs);
  }
}

function registerApiBackoff(response: Response): void {
  if (response.status === 429) {
    const retryAfterMs = getRetryAfterMs(response.headers.get('retry-after'));
    apiBackoffUntil = Math.max(apiBackoffUntil, Date.now() + retryAfterMs);
    return;
  }

  if (response.status >= 500) {
    apiBackoffUntil = Math.max(apiBackoffUntil, Date.now() + API_SERVER_ERROR_BACKOFF_MS);
  }
}

function getRetryAfterMs(retryAfter: string | null): number {
  if (retryAfter === null) {
    return API_RATE_LIMIT_BACKOFF_MS;
  }

  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds)) {
    return Math.max(seconds * 1000, API_RATE_LIMIT_BACKOFF_MS);
  }

  const retryAt = Date.parse(retryAfter);

  if (Number.isNaN(retryAt)) {
    return API_RATE_LIMIT_BACKOFF_MS;
  }

  return Math.max(retryAt - Date.now(), API_RATE_LIMIT_BACKOFF_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
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

  return [...umaEntries]
    .filter((entry) => entry.umaId !== undefined && (entry.matches ?? 0) > 0)
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

  return [...umaEntries]
    .filter((entry) => entry.umaId !== undefined && (entry.matches ?? 0) > 0)
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

  return [...umaEntries]
    .filter((entry) => entry.umaId !== undefined && (entry.matches ?? 0) >= BEST_UMA_MIN_MATCHES)
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
  const umaId = entry.umaId ?? 'unknown';
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
    name: metadata?.label ?? umaId,
    imageUrl: metadata?.imageUrl,
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

function buildRecentMatchSummaries(
  historyEntries: ApiPlayerHistoryEntry[] | undefined,
  umaMetadata: UmaMetadataLookup
): PlayerRecentMatchSummary[] {
  if (historyEntries === undefined) {
    return [];
  }

  return historyEntries
    .filter((entry) => entry.matchId !== undefined && entry.reportedAt !== undefined)
    .map((entry) => {
      const umaId = entry.selectedUmaId ?? null;

      return {
        matchId: entry.matchId ?? 'unknown',
        reportedAt: entry.reportedAt ?? '',
        mode: entry.mode ?? 'ranked',
        verificationState: entry.verificationState ?? 'unknown',
        umaId,
        umaName: umaId === null ? 'Disqualified' : umaMetadata.get(umaId)?.label ?? umaId,
        isWinner: entry.isWinner ?? null,
        pointsScored: entry.pointsScored ?? 0,
        podiums: entry.podiumPlacements ?? 0,
        isMvp: entry.isMvp ?? false,
        eloDelta: entry.eloDelta
      };
    });
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
