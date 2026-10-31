import type { EsportsTeamIconMap } from '@umalytics/shared';
import type { SeasonLeaderboard } from '@umalytics/core/profiles/playerProfileApi';
import { fetchTeamIconMap } from '@umalytics/core/profiles/esportsTeamApi';
import { getCoreStorage } from '@umalytics/core/platform';
import { desktopUiServices } from './services';

const LEADERBOARD_TTL = 10 * 60 * 1000;
const TEAM_ICON_TTL = 24 * 60 * 60 * 1000;
const TEAM_ICON_KEY = 'esportsTeamIconMapV1';
export interface LeaderboardSnapshot { data: SeasonLeaderboard; fetchedAt: number }
let leaderboard: LeaderboardSnapshot | undefined;
let leaderboardRequest: Promise<LeaderboardSnapshot> | undefined;
let teamRequest: Promise<EsportsTeamIconMap> | undefined;
export const cachedLeaderboard = () => leaderboard;
export function loadDesktopLeaderboard(force = false): Promise<LeaderboardSnapshot> {
  if (!force && leaderboard && Date.now() - leaderboard.fetchedAt < LEADERBOARD_TTL) return Promise.resolve(leaderboard);
  return leaderboardRequest ??= desktopUiServices.loadSeasonLeaderboard(new AbortController().signal)
    .then(data => leaderboard = { data, fetchedAt: Date.now() })
    .finally(() => { leaderboardRequest = undefined; });
}

// Cosmetic data loads once per app session; a failed refresh keeps the 24h cache.
export function loadDesktopTeamIcons(): Promise<EsportsTeamIconMap> {
  return teamRequest ??= (async () => {
    let cached: { map: EsportsTeamIconMap; fetchedAt: number } | undefined;
    const storage = getCoreStorage()?.local;
    try {
      const raw = (await storage?.get(TEAM_ICON_KEY))?.[TEAM_ICON_KEY] as typeof cached;
      if (raw && typeof raw.fetchedAt === 'number' && raw.map && typeof raw.map === 'object' && !Array.isArray(raw.map)) cached = raw;
    } catch { /* A missing cosmetic cache must not block the app. */ }
    if (cached && Date.now() - cached.fetchedAt < TEAM_ICON_TTL) return cached.map;
    try {
      const map = await fetchTeamIconMap(new AbortController().signal);
      try { await storage?.set({ [TEAM_ICON_KEY]: { map, fetchedAt: Date.now() } }); } catch { /* Keep the session result. */ }
      return map;
    } catch { return cached?.map ?? {}; }
  })();
}
