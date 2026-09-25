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
