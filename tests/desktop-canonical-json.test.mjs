import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../apps/desktop/src/canonicalJson.mjs';

test('canonical JSON ignores object key order at every nesting level', () => {
  const left = { request_id: '', build: { stats: { speed: 1600, stamina: 1200 }, skills: [{ id: 12, level: 2 }] }, race: { map_id: 8, weather: 2 } };
  const right = { race: { weather: 2, map_id: 8 }, build: { skills: [{ level: 2, id: 12 }], stats: { stamina: 1200, speed: 1600 } }, request_id: '' };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.notEqual(canonicalJson(left), canonicalJson({ ...right, race: { ...right.race, weather: 3 } }));
});
