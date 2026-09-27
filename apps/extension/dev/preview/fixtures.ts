import type {
  DraftSnapshot,
  EsportsTeamIconMap,
  PlayerProfileSummary,
  PlayerRecentMatchSummary,
  PlayerTopUmaSummary,
  PrematchPlayer,
  PrematchRoster
} from '@umalytics/shared';
import type { SeasonLeaderboard, SeasonLeaderboardEntry } from '../../profiles/playerProfileApi';
import type { PlayerSearchResult } from '../../explorer/explorerTypes';

// Fixture data for apps/extension/dev/preview only. Never imported by the
// extension itself, so it never reaches a build.

let umaCounter = 0;

function uma(name: string, matches: number, winRate: number, ppg: number, mvpMatches = 0): PlayerTopUmaSummary {
  umaCounter += 1;
  return {
    umaId: `uma-${umaCounter}`,
    imageUrl: '/portrait-fixture.svg',
    name,
    matches,
    wins: Math.round(matches * winRate),
    losses: matches - Math.round(matches * winRate),
    winRate,
    points: Math.round(matches * ppg),
    pointsPerGame: ppg,
    podiums: Math.round(matches * 0.6),
    mvpMatches,
    performanceScore: Math.round((Math.min(Math.max(ppg, 0) / 8, 1) * 0.7 + Math.min(Math.max(winRate, 0), 1) * 0.2 + 0.6 * 0.1) * 100)
  };
}

const UMA_NAMES = [
  'Special Week', 'Silence Suzuka', 'Tokai Teio', 'Vodka', 'Daiwa Scarlet',
  'Gold Ship', 'Grass Wonder', 'Oguri Cap', 'Mejiro McQueen', 'Symboli Rudolf',
  'Rice Shower', 'Mihono Bourbon'
];

function recentMatch(index: number, umaName: string, win: boolean): PlayerRecentMatchSummary {
  return {
    matchId: `M${1000 + index}`,
    reportedAt: new Date(Date.now() - index * 86_400_000).toISOString(),
    mode: 'ranked',
    verificationState: 'confirmed',
    umaId: `uma-history-${index}`,
    umaName,
    isWinner: win,
    result: win ? 'win' : 'loss',
    pointsScored: index === 3 ? 1 : win ? 12 + (index % 4) : 2 + (index % 3),
    podiums: win ? 1 : 0,
    isMvp: win && index % 3 === 0
  };
}

function baseProfile(discordId: string, overrides: Partial<PlayerProfileSummary> = {}): PlayerProfileSummary {
  return {
    discordId,
    displayName: overrides.displayName,
    fetchedAt: Date.now(),
    profileUrl: `https://drafter.uma.guide/players/${discordId}`,
    rank: 12,
    rating: 1580,
    conservativeRating: 1540,
    wins: 44,
    losses: 31,
    winRate: 0.587,
    matches: 75,
    points: 640,
    pointsPerGame: 8.5,
    podiums: 51,
    mvpMatches: 14,
    ...overrides
  };
}

// getLookupDiscordId (playerProfileDisplay.tsx) only treats a 16-20 digit
// numeric string as a real Discord snowflake; anything else (e.g. "discord-0")
// is treated as "no lookup available" and renders the fallback note instead
// of real card content, which is not what these fixtures are for.
export function discordId(index: number): string {
  return `10000000000000${String(index).padStart(4, '0')}`;
}

function player(index: number, team: 'team1' | 'team2', name: string, extra: Partial<PrematchPlayer> = {}): PrematchPlayer {
  return {
    userId: `user-${index}`,
    discordId: discordId(index),
    displayName: name,
    partyId: null,
    partyRatingBonus: 0,
    team,
    initialTeam: team,
    finalTeam: team,
    role: index === 0 || index === 5 ? 'captain' : 'player',
    isCaptain: index === 0 || index === 5,
    ratingSnapshot: 1550 + index * 7,
    displayRatingSnapshot: 1550 + index * 7,
    ...extra
  };
}

const TEAM1_NAMES = ['Rose Tempest', 'Nightfall Duo', 'Amber Sprint', 'Blue Comet', 'Iron Hoof'];
const TEAM2_NAMES = ['literally 1984', 'Silver Gale', 'Twin Crown', 'Echo Drift', 'Last Furlong'];

export const PREVIEW_PLAYERS: PrematchPlayer[] = [
  ...TEAM1_NAMES.map((name, i) => player(i, 'team1', name, i < 2 ? { partyId: 'fixture-duo' } : {})),
  ...TEAM2_NAMES.map((name, i) => player(i + 5, 'team2', name))
];

export const PREVIEW_ROSTER: PrematchRoster = {
  matchCode: 'PVW123',
  phase: 'lobby',
  players: PREVIEW_PLAYERS,
  teams: {
    team1: { id: 'team1', name: 'Rose Tempest Alliance', players: PREVIEW_PLAYERS.filter((p) => p.team === 'team1') },
    team2: { id: 'team2', name: 'literally 1984', players: PREVIEW_PLAYERS.filter((p) => p.team === 'team2') }
  }
};

function topUmasFor(count: number): PlayerTopUmaSummary[] {
  return UMA_NAMES.slice(0, count).map((name, i) => uma(name, 40 - i * 6, 0.62 - i * 0.05, 9.4 - i * 0.8, 3 - i));
}

// player 0: captain, rich profile, plenty of Umas (top 3 of many shown).
// player 1: fewer than MAX_TOP_UMAS (3) Umas played — the requested edge case.
// player 2: loading (no profile yet).
// player 3: hidden stats, no displayable lists.
// player 4: error loading the profile.
// player 5: captain, rich profile (mirrors player 0 on team 2).
// player 6: another player with restricted ranked stats.
// player 7-8: rich profiles with varied ranks for a filled-out second team.
// player 9: loaded profile with zero ranked Umas — the "no ranked Uma data
// found" message state, distinct from the private/error card states.
export const PREVIEW_PROFILES: Record<string, PlayerProfileSummary> = {
  [discordId(0)]: baseProfile(discordId(0), {
    displayName: 'Rose Tempest',
    title: 'Cup Champion',
    matches: 97,
    topUmas: topUmasFor(5),
    allUmas: [...topUmasFor(6), uma('Grass Wonder', 2, 0.5, 3)],
    recentMatches: [recentMatch(1, 'Special Week', true), recentMatch(2, 'Silence Suzuka', true), recentMatch(3, 'Gold Ship', false), recentMatch(4, 'Tokai Teio', true), recentMatch(5, 'Vodka', false)],
    historyTotal: 75
  }),
  [discordId(1)]: baseProfile(discordId(1), {
    displayName: 'Nightfall Duo',
    rank: 340,
    rating: 1290,
    matches: 6,
    winRate: 0.33,
    pointsPerGame: 4.1,
    topUmas: [uma('Rice Shower', 4, 0.25, 3.5)],
    allUmas: [uma('Rice Shower', 4, 0.25, 3.5)]
  }),
  [discordId(3)]: baseProfile(discordId(3), {
    displayName: 'Blue Comet',
    statsPrivate: true,
    topUmas: [],
    allUmas: []
  }),
  [discordId(4)]: baseProfile(discordId(4), {
    displayName: 'Iron Hoof',
    error: 'Stats API returned a 502. Try again shortly.',
    topUmas: [],
    allUmas: []
  }),
  [discordId(5)]: baseProfile(discordId(5), {
    displayName: 'literally 1984',
    title: 'Season 4 Finalist',
    rank: 3,
    rating: 1910,
    topUmas: topUmasFor(4),
    allUmas: topUmasFor(4)
  }),
  [discordId(6)]: baseProfile(discordId(6), {
    displayName: 'Silver Gale',
    statsPrivate: true,
    historyTotal: 34,
    topUmas: [],
    allUmas: []
  }),
  [discordId(7)]: baseProfile(discordId(7), { displayName: 'Twin Crown', rank: 88, topUmas: topUmasFor(3), allUmas: topUmasFor(3) }),
  [discordId(8)]: baseProfile(discordId(8), { displayName: 'Echo Drift', rank: 205, topUmas: topUmasFor(3), allUmas: topUmasFor(3) }),
  [discordId(9)]: baseProfile(discordId(9), { displayName: 'Last Furlong', rank: 512, matches: 0, wins: 0, losses: 0, winRate: 0, points: 0, pointsPerGame: 0, podiums: 0, mvpMatches: 0, topUmas: [], allUmas: [] })
};

export const PREVIEW_LOADING_DISCORD_IDS = [discordId(2)];

// Player 0 (Rose Tempest, team1 captain) is the mapped Uma League player: it
// exercises the lobby card, the drawer and the Players leaderboard row all
// from one fixture. Every other player has no entry, the same as a player
// with no active-season team.
export const PREVIEW_TEAM_ICONS: EsportsTeamIconMap = {
  [discordId(0)]: {
    teamId: 'team-rose-tempest',
    teamName: 'Rose Tempest Alliance',
    logoUrl: '/team-fixture.svg'
  }
};

function draftPick(team: 'team1' | 'team2', order: number, name: string) {
  return { kind: 'pick' as const, team, name, order, imageUrl: '/portrait-fixture.svg' };
}

function draftVeto(team: 'team1' | 'team2', order: number, name: string) {
  return { kind: 'veto' as const, team, name, order, imageUrl: '/portrait-fixture.svg' };
}

function draftBan(team: 'team1' | 'team2', order: number, name: string) {
  return { kind: 'ban' as const, team, name, order, imageUrl: '/portrait-fixture.svg' };
}

function mapSelection(team: 'team1' | 'team2', order: number, name: string, extra: Record<string, unknown> = {}) {
  return { team, name, order, status: 'selected' as const, track: name, ...extra };
}

export const PREVIEW_DRAFT_MID: DraftSnapshot = {
  matchCode: 'PVW123',
  source: 'synced-draft-state',
  currentTeam: 'team2',
  phase: 'picks',
  rules: { maps: 4, picks: 6, bans: 2, vetoes: 1, mapVetoes: 1 },
  updatedAt: Date.now(),
  teams: {
    team1: {
      id: 'team1',
      name: 'Rose Tempest Alliance',
      umas: [draftPick('team1', 1, 'Special Week'), draftPick('team1', 2, 'Gold Ship'), draftBan('team1', 1, 'Mejiro McQueen')],
      maps: [mapSelection('team1', 1, 'Tokyo', { distance: 2400, surface: 'Turf', season: 'Spring', weather: 'Sunny', ground: 'Good' })]
    },
    team2: {
      id: 'team2',
      name: 'literally 1984',
      umas: [draftPick('team2', 1, 'Vodka')],
      maps: [mapSelection('team2', 1, 'Nakayama', { distance: 1800, surface: 'Dirt', season: 'Winter', weather: 'Cloudy', ground: 'Soft' })]
    }
  }
};

export const PREVIEW_DRAFT_COMPLETE: DraftSnapshot = {
  matchCode: 'PVW999',
  source: 'synced-draft-state',
  phase: 'complete',
  rules: { maps: 4, picks: 6, bans: 2, vetoes: 1, mapVetoes: 1 },
  updatedAt: Date.now(),
  tiebreakerMap: { name: 'Kyoto', track: 'Kyoto', distance: 3200, surface: 'Turf', season: 'Autumn', weather: 'Rainy', ground: 'Heavy' },
  teams: {
    team1: {
      id: 'team1',
      name: 'Rose Tempest Alliance',
      umas: [
        draftPick('team1', 1, 'Special Week'), draftPick('team1', 2, 'Gold Ship'), draftPick('team1', 3, 'Tokai Teio'),
        draftPick('team1', 4, 'Grass Wonder'), draftPick('team1', 5, 'Oguri Cap'), draftPick('team1', 6, 'Symboli Rudolf'),
        draftBan('team1', 1, 'Mejiro McQueen'), draftVeto('team1', 1, 'Daiwa Scarlet')
      ],
      maps: [
        mapSelection('team1', 1, 'Tokyo', { distance: 2400, surface: 'Turf', season: 'Spring', weather: 'Sunny', ground: 'Good' }),
        mapSelection('team1', 3, 'Hanshin', { distance: 2000, surface: 'Turf', season: 'Summer', weather: 'Sunny', ground: 'Firm' }),
        { team: 'team1', name: 'Chukyo', order: undefined, status: 'vetoed' as const, track: 'Chukyo', distance: 2200 }
      ]
    },
    team2: {
      id: 'team2',
      name: 'literally 1984',
      umas: [
        draftPick('team2', 1, 'Vodka'), draftPick('team2', 2, 'Silence Suzuka'), draftPick('team2', 3, 'Rice Shower'),
        draftPick('team2', 4, 'Mihono Bourbon'), draftPick('team2', 5, 'Air Groove'), draftPick('team2', 6, 'Agnes Digital'),
        draftBan('team2', 1, 'El Condor Pasa'), draftVeto('team2', 1, 'Narita Brian')
      ],
      maps: [
        mapSelection('team2', 2, 'Nakayama', { distance: 1800, surface: 'Dirt', season: 'Winter', weather: 'Cloudy', ground: 'Soft' }),
        mapSelection('team2', 4, 'Sapporo', { distance: 2600, surface: 'Turf', season: 'Summer', weather: 'Cloudy', ground: 'Good' }),
        { team: 'team2', name: 'Fukushima', order: undefined, status: 'vetoed' as const, track: 'Fukushima', distance: 1200 }
      ]
    }
  }
};

export const PREVIEW_LEADERBOARD: SeasonLeaderboard = {
  activeSeasonId: 'season-4',
  // Rank 1 reuses player 0's discordId so it renders the same mapped Uma
  // League team icon as the lobby card and drawer.
  entries: Array.from({ length: 18 }, (_, i): SeasonLeaderboardEntry => ({
    rank: i + 1,
    userId: i === 0 ? discordId(0) : `user-lb-${i}`,
    displayName: PREVIEW_PLAYERS[i]?.displayName ?? `Ranked Player ${i + 1}`,
    rating: 2100 - i * 38,
    rd: 45,
    wins: 120 - i * 4,
    losses: 60 + i * 2
  }))
};

export const PREVIEW_SEARCH_RESULT: PlayerSearchResult = {
  page: 1,
  total: 2,
  pageSize: 20,
  players: [
    player(100, 'team1', 'Last Furlong'),
    player(101, 'team1', 'Furlong Runner')
  ]
};

export function previewHistoryPage(page: number) {
  const offset = (page - 1) * 20;
  const matches = Array.from({ length: Math.max(0, Math.min(20, 23 - offset)) }, (_, i) => recentMatch(offset + i + 1, UMA_NAMES[i % UMA_NAMES.length] ?? 'Unknown Uma', i % 2 === 0));
  return { page, total: 23, matches, summary: { wins: 13, losses: 10, pointsScored: 176, podiumPlacements: 15, firstPlaceFinishes: 6, secondPlaceFinishes: 5, thirdPlaceFinishes: 4, mvpAwards: 5 } };
}

export const PREVIEW_MANIFEST = {
  name: 'UmaLytics',
  version: '0.5.0',
  version_name: '0.5.0-rc.3'
};
