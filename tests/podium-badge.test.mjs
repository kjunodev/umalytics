import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModule } from './support/harness.mjs';

function badgesContext() {
  const c = vm.createContext({});
  loadModule(c, 'uiCommonBadges');
  return c;
}

function apiContext() {
  const c = vm.createContext({ console, URL, AbortController, setTimeout, clearTimeout, Date });
  for (const module of ['profileConstants', 'umaReleaseOrder', 'umaPortraits', 'requestQueue']) loadModule(c, module);
  loadModule(c, 'playerProfileApi');
  return c;
}

const baseProfile = (podiums, matches) => ({
  discordId: '1', podiums, matches, statsPrivate: false,
  topUmas: [], bestUmas: [], allUmas: [], recentMatches: [{}]
});

test('podiumRegular badge is absent just below the per-game threshold', () => {
  const c = badgesContext();
  const profile = baseProfile(279, 100);
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'podiumRegular'), false);
});

test('podiumRegular badge appears at exactly the per-game threshold', () => {
  const c = badgesContext();
  const profile = baseProfile(2.8 * 20, 20);
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'podiumRegular'), true);
});

test('podiumRegular badge is absent with 14 games even above the per-game threshold', () => {
  const c = badgesContext();
  const profile = baseProfile(3 * 14, 14);
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'podiumRegular'), false);
});

test('podiumRegular badge appears with 15 games at the per-game threshold', () => {
  const c = badgesContext();
  const profile = baseProfile(2.8 * 15, 15);
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'podiumRegular'), true);
});

test('a player with 351 podiums in 155 games (the original 226% bug case) gets no badge', () => {
  const c = badgesContext();
  const profile = baseProfile(351, 155);
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'podiumRegular'), false,
    '351/155 = 2.26 per game, below the 2.8 per-game threshold');
});

test('podiumRegular tooltip uses one decimal per-game phrasing with no percentage', () => {
  const c = badgesContext();
  const profile = baseProfile(445, 155);
  const badges = c.getNotableBadges(profile);
  const podiumBadge = badges.find(b => b.kind === 'podiumRegular');
  assert.ok(podiumBadge);
  assert.equal(podiumBadge.title, 'Averages 2.9 podium finishes per game (445 in 155 games), with 15+ games in the selected stat scope.');
});

test('calculatePerformanceScore clamps podiumRate when podiums exceed 3 per game', () => {
  const c = apiContext();
  const metadata = new Map();
  const leaderboard = { ranksByDiscordId: new Map() };
  const player = { discordId: '1', displayName: 'Fixture' };
  const highPodiumStats = {
    summary: { matchesIncluded: 4, totalPointsScored: 12, totalPodiumPlacements: 20, totalMvpMatches: 1 },
    umaEntries: [{ umaId: '100101', matches: 4, wins: 3, losses: 1, pointsScored: 12, podiumPlacements: 20, mvpMatches: 1 }]
  };
  const overCapEntry = {
    discordId: '1', displayName: 'Fixture', nickname: null, title: null, statsHidden: false,
    stats: highPodiumStats, history: { total: 0, summary: {
      wins: 0, losses: 0, pointsScored: 0, podiumPlacements: 0,
      firstPlaceFinishes: 0, secondPlaceFinishes: 0, thirdPlaceFinishes: 0, mvpAwards: 0
    }, recent: [] }
  };
  const summary = c.mapBatchPlayer(player, overCapEntry, 'currentSeason', 'S1', leaderboard, metadata);
  const umaSummary = summary.currentSeasonStats.allUmas.find(u => u.umaId === '100101');
  assert.ok(umaSummary, 'expected the fixture Uma to appear in allUmas');
  assert.ok(umaSummary.performanceScore <= 100, 'clamped podiumRate must not push the score past 100');

  const cappedStats = {
    summary: { matchesIncluded: 4, totalPointsScored: 12, totalPodiumPlacements: 12, totalMvpMatches: 1 },
    umaEntries: [{ umaId: '100101', matches: 4, wins: 3, losses: 1, pointsScored: 12, podiumPlacements: 12, mvpMatches: 1 }]
  };
  const cappedEntry = { ...overCapEntry, stats: cappedStats };
  const cappedSummary = c.mapBatchPlayer(player, cappedEntry, 'currentSeason', 'S1', leaderboard, metadata);
  const cappedUma = cappedSummary.currentSeasonStats.allUmas.find(u => u.umaId === '100101');
  assert.equal(cappedUma.performanceScore, umaSummary.performanceScore,
    'podiumRate above 1.0 (20 podiums / 12 max) must clamp the same as exactly at the cap (12 podiums / 12 max)');
});
