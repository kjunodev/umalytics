import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModule } from './support/harness.mjs';

function backgroundContext() {
  const c = vm.createContext({});
  loadModule(c, 'profileStates');
  return c;
}

function uiContext() {
  const c = vm.createContext({});
  loadModule(c, 'uiCommonBadges');
  return c;
}

const matchesOnlyProfile = { discordId: '1', matches: 10, topUmas: [], bestUmas: [], allUmas: [], recentMatches: [] };
const currentSeasonOnlyProfile = { discordId: '2', currentSeasonStats: { matches: 3 } };
const topUmasProfile = { discordId: '3', topUmas: [{ umaId: '100101', matches: 1, wins: 1, losses: 0, pointsScored: 3 }] };

test('background hasUsableProfileStats treats a bare matches count as usable', () => {
  const c = backgroundContext();
  assert.equal(c.hasUsableProfileStats(matchesOnlyProfile), true);
});

test('UI hasDisplayableProfileLists requires a non-empty Uma/match list, not just a matches count', () => {
  const c = uiContext();
  assert.equal(c.hasDisplayableProfileLists(matchesOnlyProfile), false);
});

test('background hasUsableProfileStats treats current-season matches as usable', () => {
  const c = backgroundContext();
  assert.equal(c.hasUsableProfileStats(currentSeasonOnlyProfile), true);
});

test('UI hasDisplayableProfileLists ignores current-season matches with no Uma/match lists', () => {
  const c = uiContext();
  assert.equal(c.hasDisplayableProfileLists(currentSeasonOnlyProfile), false);
});

test('background hasUsableProfileStats and UI hasDisplayableProfileLists agree when topUmas is populated', () => {
  const background = backgroundContext();
  const ui = uiContext();
  assert.equal(background.hasUsableProfileStats(topUmasProfile), true);
  assert.equal(ui.hasDisplayableProfileLists(topUmasProfile), true);
});

test('UI hasDisplayableProfileLists returns false for an undefined profile', () => {
  const c = uiContext();
  assert.equal(c.hasDisplayableProfileLists(undefined), false);
});

test('badge kinds are stable and MVP Menace requires 20 games and a 20% MVP rate', () => {
  const c = uiContext();
  const profile = { discordId: '1', rank: 8, matches: 20, mvpMatches: 4 };
  const badges = c.getNotableBadges(profile);
  assert.deepEqual(Array.from(badges, badge => badge.kind), ['top10', 'mvpMenace']);
  assert.equal(badges[1].label, 'MVP Menace');
  assert.match(badges[1].title, /20%/);
  assert(!c.getNotableBadges({ ...profile, matches: 19 }).some(badge => badge.kind === 'mvpMenace'));
  assert(!c.getNotableBadges({ ...profile, mvpMatches: 3 }).some(badge => badge.kind === 'mvpMenace'));
  assert.equal(c.getNotableBadges({ statsPrivate: true })[0].kind, 'private');
});

function uma(umaId, matches, extra = {}) {
  return { umaId, name: umaId, matches, wins: 0, losses: 0, winRate: null, points: 0, pointsPerGame: null, podiums: 0, mvpMatches: 0, ...extra };
}

test('One-trick requires a single Uma at >=40% of >=20 games, and wins over Deep pool', () => {
  const c = uiContext();
  const oneTrickProfile = { discordId: '1', matches: 50, allUmas: [uma('oguriCap', 23, { name: 'Oguri Cap' }), uma('specialWeek', 20)] };
  const badges = c.getNotableBadges(oneTrickProfile);
  assert.equal(badges.some(b => b.kind === 'oneTrick'), true);
  assert.equal(badges.some(b => b.kind === 'deepPool'), false);
  const badge = badges.find(b => b.kind === 'oneTrick');
  assert.equal(badge.label, 'One-trick');
  assert.match(badge.title, /Oguri Cap/);
  assert.match(badge.title, /46%/);
  assert.match(badge.title, /23 of 50/);

  // Below the 40% share: no badge (top Uma is 19 of 50 = 38%).
  assert(!c.getNotableBadges({ discordId: '1', matches: 50, allUmas: [uma('a', 19), uma('b', 19), uma('c', 12)] }).some(b => b.kind === 'oneTrick'));
  // Below the 20-game floor even at 100% share: no badge.
  assert(!c.getNotableBadges({ discordId: '1', matches: 19, allUmas: [uma('a', 19)] }).some(b => b.kind === 'oneTrick'));
  // At exactly the boundaries: 20 games, top Uma at exactly 40% share (8 of 20) qualifies.
  assert(c.getNotableBadges({ discordId: '1', matches: 20, allUmas: [uma('a', 8), uma('b', 6), uma('c', 6)] }).some(b => b.kind === 'oneTrick'));
});

test('Deep pool requires 8+ distinct Umas with 3+ games each, and never shows alongside One-trick', () => {
  const c = uiContext();
  const eightUmas = Array.from({ length: 8 }, (_, i) => uma(`u${i}`, 3));
  const profile = { discordId: '1', matches: 24, allUmas: eightUmas };
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'deepPool'), true);
  const badge = badges.find(b => b.kind === 'deepPool');
  assert.match(badge.title, /8/);
  assert.match(badge.title, /3\+/);

  // Only 7 Umas with enough games: no badge.
  assert(!c.getNotableBadges({ discordId: '1', matches: 21, allUmas: eightUmas.slice(0, 7) }).some(b => b.kind === 'deepPool'));
  // 8 Umas but one under 3 games: no badge.
  const sevenPlusOneLow = [...eightUmas.slice(0, 7), uma('low', 2)];
  assert(!c.getNotableBadges({ discordId: '1', matches: 23, allUmas: sevenPlusOneLow }).some(b => b.kind === 'deepPool'));

  // One-trick + Deep pool both technically qualify: One-trick wins, Deep pool is suppressed.
  const withOneTrickAndDeepPool = { discordId: '1', matches: 50, allUmas: [uma('main', 20), ...eightUmas] };
  const combinedBadges = c.getNotableBadges(withOneTrickAndDeepPool);
  assert.equal(combinedBadges.some(b => b.kind === 'oneTrick'), true);
  assert.equal(combinedBadges.some(b => b.kind === 'deepPool'), false);
});

test('Podium regular requires a >=60% podium rate with 15+ games', () => {
  const c = uiContext();
  const profile = { discordId: '1', matches: 20, podiums: 12 };
  const badges = c.getNotableBadges(profile);
  const badge = badges.find(b => b.kind === 'podiumRegular');
  assert.notEqual(badge, undefined);
  assert.match(badge.title, /60%/);
  assert.match(badge.title, /12 of 20/);

  assert(!c.getNotableBadges({ discordId: '1', matches: 14, podiums: 9 }).some(b => b.kind === 'podiumRegular'), 'below the 15-game floor');
  assert(!c.getNotableBadges({ discordId: '1', matches: 20, podiums: 11 }).some(b => b.kind === 'podiumRegular'), 'below the 60% rate');
  assert(c.getNotableBadges({ discordId: '1', matches: 15, podiums: 9 }).some(b => b.kind === 'podiumRegular'), 'exactly at both boundaries');
});

test('Underrated requires 5.5+ PPG over 15+ games while ranked outside the top 100 or unranked', () => {
  const c = uiContext();
  const unrankedProfile = { discordId: '1', matches: 15, pointsPerGame: 5.5, rank: null };
  assert(c.getNotableBadges(unrankedProfile).some(b => b.kind === 'underrated'));
  const rankedOutsideTop100 = { discordId: '1', matches: 20, pointsPerGame: 6.2, rank: 145 };
  const badge = c.getNotableBadges(rankedOutsideTop100).find(b => b.kind === 'underrated');
  assert.notEqual(badge, undefined);
  assert.match(badge.title, /6\.2/);
  assert.match(badge.title, /#145/);

  assert(!c.getNotableBadges({ discordId: '1', matches: 14, pointsPerGame: 6, rank: null }).some(b => b.kind === 'underrated'), 'below the 15-game floor');
  assert(!c.getNotableBadges({ discordId: '1', matches: 15, pointsPerGame: 5.4, rank: null }).some(b => b.kind === 'underrated'), 'below the PPG floor');
  assert(!c.getNotableBadges({ discordId: '1', matches: 20, pointsPerGame: 7, rank: 100 }).some(b => b.kind === 'underrated'), 'rank #100 is still inside the top 100');
  assert(c.getNotableBadges({ discordId: '1', matches: 20, pointsPerGame: 7, rank: 101 }).some(b => b.kind === 'underrated'), 'rank #101 is just outside the top 100');
});

test('Newcomer: currentSeason scope needs no all-time data once season matches already reach the threshold', () => {
  const c = uiContext();
  assert(!c.getNotableBadges({ discordId: '1', statsScope: 'currentSeason', matches: 10 }).some(b => b.kind === 'newcomer'));
  assert(!c.getNotableBadges({ discordId: '1', statsScope: 'currentSeason', matches: 25, allTimeStats: { matches: 3 } }).some(b => b.kind === 'newcomer'));
});

test('Newcomer: currentSeason scope under 10 season games falls back to the fetched all-time count', () => {
  const c = uiContext();
  // All-time count not fetched yet: no badge (also no crash).
  assert(!c.getNotableBadges({ discordId: '1', statsScope: 'currentSeason', matches: 4 }).some(b => b.kind === 'newcomer'));
  assert(!c.getNotableBadges({ discordId: '1', statsScope: 'currentSeason', matches: 4, allTimeStats: { matches: null } }).some(b => b.kind === 'newcomer'));

  const badges = c.getNotableBadges({ discordId: '1', statsScope: 'currentSeason', matches: 4, allTimeStats: { matches: 7 } });
  const badge = badges.find(b => b.kind === 'newcomer');
  assert.notEqual(badge, undefined);
  assert.match(badge.title, /7 total/);

  assert(!c.getNotableBadges({ discordId: '1', statsScope: 'currentSeason', matches: 4, allTimeStats: { matches: 10 } }).some(b => b.kind === 'newcomer'), 'all-time count reaching the threshold clears it');
});

test('Newcomer: allTime scope uses the loaded matches count directly', () => {
  const c = uiContext();
  assert(c.getNotableBadges({ discordId: '1', statsScope: 'allTime', matches: 9 }).some(b => b.kind === 'newcomer'));
  assert(!c.getNotableBadges({ discordId: '1', statsScope: 'allTime', matches: 10 }).some(b => b.kind === 'newcomer'));
  assert(!c.getNotableBadges({ discordId: '1', statsScope: 'allTime', matches: null }).some(b => b.kind === 'newcomer'));
});
