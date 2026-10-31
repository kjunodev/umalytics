import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function module(path, imports = {}) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInNewContext(compiled, { exports, structuredClone, require: name => imports[name] });
  return exports;
}
const types = module('../apps/desktop/src/staminaTypes.ts');
const writes = [];
const store = { get: async () => undefined, set: async (key, value) => writes.push([key, value]), save: async () => {} };
const { fuzzyScore, restoreStaminaMemory, loadStaminaMemory, saveStaminaMemory } = module('../apps/desktop/src/staminaState.ts', {
  './staminaTypes': types, '@tauri-apps/plugin-store': { load: async path => { assert.equal(path, 'stamina.json'); return store; } }
});
const catalog = { courses: [{ id: 'hanshin' }], skills: [{ id: 1, rarity: 'unique' }, { id: 2, rarity: 'gold' }] };
const plain = value => JSON.parse(JSON.stringify(value));

test('dock state and valid match-scoped course choices survive storage', () => {
  const choices = { ABC123: { race: 'hanshin', removed: 'missing' }, XYZ789: { race: 42 }, empty: null };
  const restored = restoreStaminaMemory({ buildOpen: true, courseChoices: choices }, catalog);
  assert.equal(restored.buildOpen, true);
  assert.deepEqual(plain(restored.courseChoices), { ABC123: { race: 'hanshin' } });
  assert.equal(restoreStaminaMemory({ buildOpen: false }, catalog).buildOpen, false);
  assert.equal(restoreStaminaMemory({ buildOpen: 'false', courseChoices: [] }, catalog).buildOpen, undefined);
});

test('stamina memory restores race, conditions, every build field and advanced option', () => {
  const input = structuredClone(types.defaultStaminaInput);
  input.race = { map_id: 'hanshin', ground_condition: 4, weather: 3, season: 2 };
  input.field = 'mirror'; input.build.motivation = 3; input.build.running_style = 4;
  input.build.stats = { speed: 1600, stamina: 999, pow: 1200, guts: 700, wiz: 1200 };
  input.build.distance = [8, 6, 7, 5]; input.build.ground = [8, 7]; input.build.style = [5, 6, 7, 8];
  input.build.skills = [{ id: 1, level: 6 }, { id: 2, level: 1 }];
  for (const key of ['assume_skills_activate', 'rushed', 'lane_movement']) input[key] = false;
  input.dueling = true; input.spot_struggle = true; input.seeds = 512;
  assert.deepEqual(plain(restoreStaminaMemory({ input, recent: [2, 1], buildTab: 'race-settings', showAll: true }, catalog)), { input, recent: [2, 1], buildTab: 'race-settings', buildCustomized: true });
});

test('stamina memory rejects corrupt values, stale skill IDs and duplicate skills', () => {
  const restored = restoreStaminaMemory({ input: { request_id: 'stale', field: 'bogus', seeds: 0,
    race: { map_id: 'missing', weather: 999 }, build: { stats: { speed: null, stamina: 2001 }, distance: [1, 2],
      skills: [{ id: 1, level: 99 }, { id: 1, level: 2 }, { id: 2, level: 6 }, { id: 999, level: 1 }] } }, recent: [2, 2, 999, null] }, catalog);
  assert.deepEqual(plain(restored.input.build.skills), [{ id: 1, level: 1 }, { id: 2, level: 1 }]);
  assert.equal(restored.input.build.stats.stamina, 800);
  assert.equal(restored.input.request_id, ''); assert.equal(restored.input.field, 'average_lobby');
  assert.deepEqual(plain(restored.recent), [2]);
  for (const bad of [null, [], 'broken']) assert.equal(restoreStaminaMemory(bad, catalog).input.build.motivation, 5);
});

test('stamina writes immutable snapshots in order without persisting request IDs', async () => {
  await loadStaminaMemory(catalog);
  const memory = restoreStaminaMemory(undefined, catalog);
  memory.input.request_id = 'transient';
  const first = saveStaminaMemory(memory);
  memory.input.build.stats.stamina = 1100;
  await Promise.all([first, saveStaminaMemory(memory)]);
  assert.deepEqual(writes.map(([key, value]) => [key, value.input.build.stats.stamina, value.input.request_id]), [['last-inputs-v1', 800, ''], ['last-inputs-v1', 1100, '']]);
});

test('skill search matches case, accents, subsequences and IDs; excludes nonmatches', () => {
  assert.equal(fuzzyScore('Swinging Maestro', 'swinging'), 0);
  assert(Number.isFinite(fuzzyScore('Swinging Maestro', 'swng mst')));
  assert.equal(fuzzyScore('Élan 123', 'elan'), 0);
  assert(Number.isFinite(fuzzyScore('Skill 200351', '200351')));
  assert.equal(fuzzyScore('Swinging Maestro', 'xyz'), Infinity);
});
