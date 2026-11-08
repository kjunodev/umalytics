import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { drawerProfileLoading, getHistoryPageRows, getHistoryPageSlices } from '../apps/desktop/src/playerDrawerPaging.ts';

test('eight-row UI pages request only the twenty-row API pages they touch', () => {
  assert.deepEqual(getHistoryPageSlices(1, 55), [{ apiPage: 1, start: 0, end: 8 }]);
  assert.deepEqual(getHistoryPageSlices(2, 55), [{ apiPage: 1, start: 8, end: 16 }]);
  assert.deepEqual(getHistoryPageSlices(3, 55), [{ apiPage: 1, start: 16, end: 20 }, { apiPage: 2, start: 0, end: 4 }]);
  assert.deepEqual(getHistoryPageSlices(6, 55), [{ apiPage: 3, start: 0, end: 8 }]);
  assert.deepEqual(getHistoryPageSlices(7, 55), [{ apiPage: 3, start: 8, end: 15 }]);
});

test('page three joins items 16–23 in order and waits for both API pages', () => {
  const pages = Object.fromEntries([1, 2, 3].map(page => [page, { matches: Array.from({ length: 20 }, (_, i) => (page - 1) * 20 + i) }]));
  assert.deepEqual(getHistoryPageRows(pages, 3, 55), [16, 17, 18, 19, 20, 21, 22, 23]);
  assert.deepEqual(getHistoryPageRows({ 1: pages[1] }, 3, 55), []);
  assert.deepEqual(getHistoryPageRows(pages, 7, 55), [48, 49, 50, 51, 52, 53, 54]);
});

test('empty, exact boundaries and short pages never request a surplus API page', () => {
  assert.deepEqual(getHistoryPageSlices(1, 0), []);
  assert.deepEqual(getHistoryPageSlices(3, 20), [{ apiPage: 1, start: 16, end: 20 }]);
  assert.deepEqual(getHistoryPageSlices(5, 40), [{ apiPage: 2, start: 12, end: 20 }]);
  assert.deepEqual(getHistoryPageSlices(2, 8), []);
  for (let total = 0; total <= 101; total++) {
    const pages = Object.fromEntries(Array.from({ length: Math.ceil(total / 20) }, (_, i) => [i + 1, { matches: Array.from({ length: Math.min(20, total - i * 20) }, (_, j) => i * 20 + j) }]));
    const rows = Array.from({ length: Math.ceil(total / 8) }, (_, i) => getHistoryPageRows(pages, i + 1, total)).flat();
    assert.deepEqual(rows, Array.from({ length: total }, (_, i) => i));
  }
});

test('a loaded profile stays visible while other lobby profiles load', () => {
  assert.equal(drawerProfileLoading(true, undefined), true);
  assert.equal(drawerProfileLoading(true, { discordId: '1' }), false);
  assert.equal(drawerProfileLoading(false, undefined), false);
  const live = fs.readFileSync(new URL('../apps/desktop/src/Live.tsx', import.meta.url), 'utf8');
  assert.ok(live.includes('loading={drawerProfileLoading(loading, profiles[context.player.discordId])}'));
});
