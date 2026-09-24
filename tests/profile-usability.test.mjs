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
