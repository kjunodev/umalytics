import type { PrematchPlayer, PrematchRoster, PrematchTeam } from '@umalytics/shared';
import { lookupPlayer, parsePlayerInput } from '../../explorer/explorerData';
import type { SeasonLeaderboardEntry } from '../../profiles/playerProfileApi';
import { getTeamGroups } from '../../room/rosterDisplay';
import { formatNumber, formatPercent } from '../common/format';
import type { RecentPlayerEntry } from '../../storage/playersRecentStorage';

export type LeaderboardSortKey = 'rank' | 'rating' | 'win' | 'games';

export const RECENT_PLAYERS_CAP = 4;
export const LEADERBOARD_TTL_MS = 10 * 60 * 1000;

/**
 * Decides whether an activation (the Players view becoming visible) should
 * trigger a leaderboard fetch: never while inactive, always on the first
 * activation (no cached fetch yet), and on a later activation only once the
 * cached data is older than LEADERBOARD_TTL_MS. `now` is passed in so this
 * stays a pure, clock-free function for testing.
 */
export function shouldLoadLeaderboard(active: boolean, fetchedAt: number | undefined, now: number): boolean {
  if (!active) return false;
  return fetchedAt === undefined || now - fetchedAt > LEADERBOARD_TTL_MS;
}

export type PlayerQueryClassification =
  | { mode: 'lookup'; id: string }
  | { mode: 'filter'; text: string };

/** Reuses explorerData's ID/URL detection so the leaderboard search and the directory-search fallback agree on what counts as a lookup. */
export function classifyPlayerQuery(query: string): PlayerQueryClassification {
  try {
    const parsed = parsePlayerInput(query);
    if (parsed.id !== undefined) return { mode: 'lookup', id: parsed.id };
    return { mode: 'filter', text: parsed.query ?? '' };
  } catch {
    return { mode: 'filter', text: query.trim() };
  }
}

export function leaderboardWinRate(entry: SeasonLeaderboardEntry): number | null {
  const games = (entry.wins ?? 0) + (entry.losses ?? 0);
  return games > 0 ? (entry.wins ?? 0) / games : null;
}

export function leaderboardGames(entry: SeasonLeaderboardEntry): number {
  return (entry.wins ?? 0) + (entry.losses ?? 0);
}

export function formatLeaderboardRecord(entry: SeasonLeaderboardEntry): string {
  return entry.wins === undefined || entry.losses === undefined ? '-' : `${entry.wins}-${entry.losses}`;
}

export function formatLeaderboardWinRate(entry: SeasonLeaderboardEntry): string {
  return formatPercent(leaderboardWinRate(entry));
}

export function formatLeaderboardGames(entry: SeasonLeaderboardEntry): string {
  return formatNumber(leaderboardGames(entry));
}

export function filterLeaderboardEntries(entries: SeasonLeaderboardEntry[], query: string): SeasonLeaderboardEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter(entry => (entry.displayName ?? '').toLowerCase().includes(needle));
}

export function sortLeaderboardEntries(entries: SeasonLeaderboardEntry[], sortKey: LeaderboardSortKey): SeasonLeaderboardEntry[] {
  const value = (entry: SeasonLeaderboardEntry): number => {
    switch (sortKey) {
      case 'rank': return entry.rank;
      case 'rating': return entry.rating === undefined ? Infinity : -entry.rating;
      case 'win': { const rate = leaderboardWinRate(entry); return rate === null ? Infinity : -rate; }
      case 'games': return -leaderboardGames(entry);
    }
  };
  return [...entries].sort((a, b) => value(a) - value(b) || a.rank - b.rank);
}

export function leaderboardEntryToPlayer(entry: SeasonLeaderboardEntry): PrematchPlayer {
  return lookupPlayer(entry.userId, entry.displayName ?? entry.userId);
}

export function rankTintClass(rank: number): string | undefined {
  if (rank === 1) return 'players-rank-gold';
  if (rank === 2) return 'players-rank-silver';
  if (rank === 3) return 'players-rank-bronze';
  return undefined;
}

export function pushRecentPlayer(recent: RecentPlayerEntry[], entry: RecentPlayerEntry, cap = RECENT_PLAYERS_CAP): RecentPlayerEntry[] {
  return [entry, ...recent.filter(existing => existing.discordId !== entry.discordId)].slice(0, cap);
}

export function findRosterTeamForPlayer(roster: PrematchRoster | undefined, discordId: string): PrematchTeam | undefined {
  for (const team of getTeamGroups(roster)) {
    if (team.players.some(player => player.discordId === discordId)) return team;
  }
  return undefined;
}
