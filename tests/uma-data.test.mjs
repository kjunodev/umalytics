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
  const syntax = parseTsxModule('uiUmasScene');
  loadFunction(c, syntax, 'getHitScopeLabel');
  assert.deepEqual(['all', 'team1', 'team2'].map(scope => c.getHitScopeLabel(scope)), ['All', 'Team 1', 'Team 2']);
  assert.doesNotMatch(readModule('uiUmasScene'), /DraftPlanTray|DRAFT_PLAN_PIN_LIMIT|pinnedUmaIds|Pin to plan/);
});

function umaPortraitContext() {
  const c = vm.createContext({ URL });
  loadModule(c, 'umaPortraits');
  return c;
}

test('New Year and Anime Kitasan Black resolve to their own portraits and names', () => {
  const c = umaPortraitContext();
  assert.match(c.getUmaPortraitUrl('106802'), /\/uma\/chara_stand_1068_106810\.webp$/);
  assert.match(c.getUmaPortraitUrl('106803'), /\/uma\/chara_stand_1068_106802\.webp$/);
  assert.equal(c.getUmaDisplayName('106802'), 'New Year Kitasan Black');
  assert.equal(c.getUmaDisplayName('106803'), 'Anime Kitasan Black');
});

test('IDs parsed from image URLs are portrait IDs and map back to the outfit', () => {
  const c = vm.createContext({ URL, cleanTeamName: x => x });
  loadModule(c, 'umaPortraits');
  loadModule(c, 'draftExtraction');
  assert.equal(c.extractUmaIdFromImageUrl('https://drafter.uma.guide/uma/chara_stand_1068_106802.webp'), '106803');
  assert.equal(c.extractUmaIdFromImageUrl('https://drafter.uma.guide/uma/chara_stand_1068_106810.webp'), '106802');
  assert.equal(c.extractUmaIdFromImageUrl('https://drafter.uma.guide/uma/chara_stand_1068_106801.webp'), '106801');
  assert.equal(c.extractUmaIdFromImageUrl('https://drafter.uma.guide/uma/none.png'), undefined);
  assert.equal(c.normalizeUmaOutfitId('106802'), '106802', 'a data-field ID that is also a portrait ID stays the outfit');
  assert.equal(c.normalizeUmaPortraitId('106802'), '106803');
});

test('the generated Uma tables are consistent and include recent releases', () => {
  const c = umaPortraitContext();
  const outfitIds = vm.runInContext('releaseOrder.map(entry => entry.outfitId)', c);
  const overrides = vm.runInContext('Array.from(UMA_PORTRAIT_ID_BY_OUTFIT_ID)', c);
  assert.equal(new Set(outfitIds).size, outfitIds.length, 'release order has no duplicate outfits');
  assert(overrides.length > 100);
  for (const [outfitId] of overrides) assert(outfitIds.includes(outfitId), `override ${outfitId} is a released outfit`);
  const portraits = outfitIds.map(id => c.getUmaPortraitUrl(id));
  assert.equal(new Set(portraits).size, portraits.length, 'no two outfits share a portrait');
  assert.equal(c.isKnownUmaOutfitId('111801'), true);
  assert.equal(c.getUmaDisplayName('111801'), 'Glacial Queen Admire Groove');
});

test('drafter image URLs resolve against the drafter origin and foreign hosts are dropped', () => {
  const c = umaPortraitContext();
  assert.equal(c.resolveDrafterImageUrl('/uma/chara_stand_1068_106810.webp'), 'https://drafter.uma.guide/uma/chara_stand_1068_106810.webp');
  assert.equal(c.resolveDrafterImageUrl('https://drafter.uma.guide/uma/a.webp'), 'https://drafter.uma.guide/uma/a.webp');
  assert.equal(c.resolveDrafterImageUrl('https://evil.example/uma/a.webp'), undefined);
  assert.equal(c.resolveDrafterImageUrl('  '), undefined);
  assert.equal(c.resolveDrafterImageUrl(undefined), undefined);
});
