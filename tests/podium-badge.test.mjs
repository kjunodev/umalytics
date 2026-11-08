import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModule } from './support/harness.mjs';
import { PREVIEW_PROFILES } from '../apps/extension/dev/preview/fixtures.ts';

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

test('rank, scoring and MVP tooltips include the player numbers', () => {
  const c = badgesContext();
  const profile = { ...baseProfile(0, 30), rank: 7, pointsPerGame: 7.25, mvpMatches: 9 };
  const titles = Object.fromEntries(c.getNotableBadges(profile).map(b => [b.kind, b.title]));
  assert.equal(titles.top10, 'Current-season rank #7.');
  assert.equal(titles.eliteScoring, 'Averages 7.3 points per game over 30 games.');
  assert.equal(titles.mvpMenace, 'MVP in 30% of games (9 of 30).');
  const other = Object.fromEntries(c.getNotableBadges({ ...profile, rank: 19, pointsPerGame: 6.5 }).map(b => [b.kind, b.title]));
  assert.equal(other.top25, 'Current-season rank #19.');
  assert.equal(other.highScoring, 'Averages 6.5 points per game over 30 games.');
});

test('Underrated uses current-season stats and retains its rank, game and scoring thresholds', () => {
  const c = badgesContext();
  const profile = { ...baseProfile(0, 15), rank: 101, pointsPerGame: 5.5 };
  const hasBadge = p => c.getNotableBadges(p).some(b => b.kind === 'underrated');
  assert.equal(hasBadge({ ...profile, statsScope: 'currentSeason' }), true);
  assert.equal(hasBadge({ ...profile, statsScope: 'allTime' }), false);
  assert.equal(hasBadge({ ...profile, rank: null, statsScope: 'allTime' }), false);
  for (const patch of [{ rank: 100 }, { matches: 14 }, { pointsPerGame: 5.49 }]) assert.equal(hasBadge({ ...profile, ...patch }), false);
});

test('an unknown rank (leaderboard unavailable) never earns rank-based badges like Underrated', () => {
  const c = badgesContext();
  const strong = { discordId: '1', matches: 40, pointsPerGame: 6.5, rank: null, statsPrivate: false, topUmas: [], bestUmas: [], allUmas: [] };
  assert.equal(c.getNotableBadges(strong).some(b => b.kind === 'underrated'), true, 'a genuinely unranked player still qualifies');
  assert.equal(c.getNotableBadges({ ...strong, rankUnavailable: true }).some(b => b.kind === 'underrated'), false);
});

test('an unknown rank is labelled unknown, never Unranked', () => {
  const c = vm.createContext({});
  loadModule(c, 'uiCommonFormat');
  assert.equal(c.formatRank({ rank: null }, false), 'Unranked');
  assert.equal(c.formatRank({ rank: null, rankUnavailable: true }, false), 'Rank unknown');
  assert.equal(c.formatRank({ rank: 3, rankUnavailable: true }, false), '#3');
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

test('Uma Score stays capped at 100 even when input rates exceed their bounds', () => {
  const c = apiContext();
  assert.equal(c.calculatePerformanceScore(20, 2, 3), 100);
  assert.equal(c.calculatePerformanceScore(3, 0.75, 20 / 12), c.calculatePerformanceScore(3, 0.75, 1));
});

test('preview fixture Uma Scores use the same 0–100 scale', () => {
  const umas = Object.values(PREVIEW_PROFILES).flatMap(profile => profile.allUmas ?? profile.topUmas ?? []);
  assert.ok(umas.length > 0);
  assert.ok(umas.every(uma => uma.performanceScore >= 0 && uma.performanceScore <= 100));
});
