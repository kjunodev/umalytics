import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModule, loadFunction, parseTsxModule, readModule } from './support/harness.mjs';

test('Uma hits count distinct lobby players with scoped experience', () => {
  const c = vm.createContext({
    releaseOrder: [],
    normalizeUmaNameForLookup: name => name.toLowerCase(),
    normalizeSearchText: name => name.toLowerCase(),
    isKnownUmaOutfitId: () => true,
    getDisplayedProfileStats: profile => profile.currentSeasonStats
  });
  loadModule(c, 'uiUmasCatalog');
  const catalog = [{ umaId: '100101', name: 'Uma A' }];
  const roster = [
    { discordId: '1', displayName: 'One' },
    { discordId: '1', displayName: 'One again' },
    { discordId: '2', displayName: 'Two' },
    { discordId: '3', displayName: 'Three' }
  ];
  const entry = { umaId: '100101', name: 'Uma A', matches: 2, pointsPerGame: 5 };
  const profiles = {
    '1': { currentSeasonStats: { allUmas: [entry] } },
    '2': { currentSeasonStats: { allUmas: [entry] } },
    '3': { currentSeasonStats: { allUmas: [] } }
  };
  assert.equal(c.getUmaHistoryCounts(catalog, roster, profiles, 'currentSeason').get('100101'), 2);
  assert.equal(c.getUmaHistoryCounts(catalog, roster.slice(2), profiles, 'currentSeason').get('100101'), 1);
});

test('Uma scope labels are All, Team 1, and Team 2 and draft plan is removed', () => {
  const c = vm.createContext({});
  const syntax = parseTsxModule('uiUmasPlannerScene');
  loadFunction(c, syntax, 'getHitScopeLabel');
  assert.deepEqual(['all', 'team1', 'team2'].map(scope => c.getHitScopeLabel(scope)), ['All', 'Team 1', 'Team 2']);
  assert.doesNotMatch(readModule('uiUmasPlannerScene'), /DraftPlanTray|DRAFT_PLAN_PIN_LIMIT|pinnedUmaIds|Pin to plan/);
});
