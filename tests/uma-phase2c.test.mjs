import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModule } from './support/harness.mjs';

function catalogContext() {
  const context = vm.createContext({
    releaseOrder: [],
    normalizeUmaNameForLookup: name => name.toLowerCase(),
    normalizeSearchText: name => name.toLowerCase(),
    isKnownUmaOutfitId: () => true
  });
  loadModule(context, 'uiUmasCatalog');
  return context;
}

const uma = (matches, wins, points, extra = {}) => ({
  umaId: '100101', name: 'Special Week', matches, wins, points,
  winRate: wins / matches, pointsPerGame: points / matches, ...extra
});

test('lobby strip weights published totals and counts each player once in the selected scope', () => {
  const c = catalogContext();
  const players = [{ discordId: '1' }, { discordId: '1' }, { discordId: '2' }];
  const profiles = {
    '1': { currentSeasonStats: { allUmas: [uma(2, 2, 20)] }, allTimeStats: { allUmas: [uma(10, 4, 30)] } },
    '2': { currentSeasonStats: { allUmas: [uma(8, 2, 16)] }, allTimeStats: { allUmas: [] } }
  };
  const action = { umaId: '100101', name: 'Special Week' };
  const seasonal = c.summarizeUmaExperience(c.getUmaExperience(action, players, profiles, 'currentSeason'));
  assert.equal(seasonal.games, 10);
  assert.equal(seasonal.winRate, 0.4);
  assert.equal(seasonal.pointsPerGame, 3.6);
  const allTime = c.summarizeUmaExperience(c.getUmaExperience(action, players, profiles, 'allTime'));
  assert.equal(allTime.games, 10);
  assert.equal(allTime.pointsPerGame, 3);
});

test('empty and unavailable stats never become a fabricated zero rate', () => {
  const c = catalogContext();
  const empty = c.summarizeUmaExperience([]);
  assert.equal(empty.games, 0);
  assert.equal(empty.winRate, null);
  assert.equal(empty.pointsPerGame, null);
  const partial = c.summarizeUmaExperience([
    { uma: uma(3, 1, 12) }, { uma: uma(2, 0, 0, { winRate: null, pointsPerGame: null }) }
  ]);
  assert.equal(partial.games, 5);
  assert.equal(partial.winRate, null);
  assert.equal(partial.pointsPerGame, null);
});

test('Most played uses player counts while Release and A–Z keep their independent ordering', () => {
  const c = catalogContext();
  const catalog = [{ umaId: 'a', name: 'Alpha', order: 1 }, { umaId: 'b', name: 'Beta', order: 3 }, { umaId: 'c', name: 'Gamma', order: 2 }];
  const counts = new Map([['a', 2], ['b', 1], ['c', 3]]);
  const ids = mode => Array.from(c.sortUmaCatalogOptions(catalog, mode, counts), entry => entry.umaId);
  assert.deepEqual(ids('lobbyHits'), ['c', 'a', 'b']);
  assert.deepEqual(ids('releaseOrder'), ['b', 'c', 'a']);
  assert.deepEqual(ids('alphabetical'), ['a', 'b', 'c']);
  assert.equal(c.filterUmaCatalogOptions(catalog, 'ALP')[0].umaId, 'a');
});
