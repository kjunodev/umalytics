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
let stored;
const store = { get: async () => stored, set: async (key, value) => { stored = value; writes.push([key, value]); }, save: async () => {} };
const { applyScreenshotBuild, editorStats, fuzzyScore, restoreStaminaMemory, loadStaminaMemory, saveStaminaMemory, undoScreenshotBuild } = module('../apps/desktop/src/staminaState.ts', {
  './staminaScreenshot': module('../apps/desktop/src/staminaScreenshot.ts'),
  './staminaTypes': types, '@tauri-apps/plugin-store': { load: async path => { assert.equal(path, 'stamina.json'); return store; } }
});
const catalog = { courses: [{ id: 'hanshin' }], skills: [{ id: 1, rarity: 'unique' }, { id: 2, rarity: 'gold' }] };
const plain = value => JSON.parse(JSON.stringify(value));

test('obsolete collapse state is dropped and match-scoped course choices survive storage', () => {
  const choices = { ABC123: { race: 'hanshin', removed: 'missing' }, XYZ789: { race: 42 }, empty: null };
  const restored = restoreStaminaMemory({ buildCollapsed: true, courseChoices: choices }, catalog);
  assert(!('buildCollapsed' in restored));
  assert.deepEqual(plain(restored.courseChoices), { ABC123: { race: 'hanshin' } });
  assert(!('buildOpen' in restored));
});

test('legacy tabs migrate even when screenshot access is disabled', () => {
  for (const [saved, tab] of Object.entries({ build: 'attributes', 'race-settings': 'race', 'scanned-skills': 'skills', presets: 'presets', invalid: 'attributes' })) {
    assert.equal(restoreStaminaMemory({ buildTab: saved }, catalog).buildTab, tab);
  }
});

test('switching views changes the editor fields and persists the view', async () => {
  assert.deepEqual(plain(editorStats('requirement')), ['speed', 'pow', 'guts', 'wiz']);
  assert.deepEqual(plain(editorStats('assessment')), ['speed', 'stamina', 'pow', 'guts', 'wiz']);
  const memory = restoreStaminaMemory({ view: 'invalid' }, catalog);
  assert.equal(memory.view, 'requirement');
  memory.view = 'assessment';
  await saveStaminaMemory(memory);
  assert.equal((await loadStaminaMemory(catalog)).view, 'assessment');
  await saveStaminaMemory({ ...memory, view: 'requirement' });
  assert.equal((await loadStaminaMemory(catalog)).view, 'requirement');
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
  assert.deepEqual(plain(restoreStaminaMemory({ input, recent: [2, 1], buildTab: 'race-settings', showAll: true }, catalog)), { input, recent: [2, 1], view: 'requirement', buildTab: 'race', buildCustomized: true });
});

test('stamina memory rejects corrupt values, stale skill IDs and duplicate skills', () => {
  const restored = restoreStaminaMemory({ input: { request_id: 'stale', field: 'bogus', seeds: 0,
    race: { map_id: 'missing', weather: 999 }, build: { stats: { speed: null, stamina: 2001 }, distance: [1, 2],
      skills: [{ id: 1, level: 99 }, { id: 1, level: 2 }, { id: 2, level: 6 }, { id: 999, level: 1 }] } }, recent: [2, 2, 999, null] }, catalog);
  assert.deepEqual(plain(restored.input.build.skills), [{ id: 1, level: 1 }, { id: 2, level: 1 }]);
  assert.equal(types.staminaValue(restored.input.build), 600);
  assert.equal(restored.input.request_id, ''); assert.equal(restored.input.field, 'average_lobby');
  assert.deepEqual(plain(restored.recent), [2]);
  for (const bad of [null, [], 'broken']) assert.equal(restoreStaminaMemory(bad, catalog).input.build.motivation, 5);
});

test('stamina writes immutable snapshots in order without persisting request IDs', async () => {
  await loadStaminaMemory(catalog);
  const memory = restoreStaminaMemory(undefined, catalog);
  writes.length = 0;
  memory.input.request_id = 'transient';
  const first = saveStaminaMemory(memory);
  memory.input.build.stats.stamina = 1100;
  await Promise.all([first, saveStaminaMemory(memory)]);
  assert.deepEqual(writes.map(([key, value]) => [key, value.input.build.stats.stamina, value.input.request_id]), [['last-inputs-v1', 600, ''], ['last-inputs-v1', 1100, '']]);
});

test('skill search matches case, accents, subsequences and IDs; excludes nonmatches', () => {
  assert.equal(fuzzyScore('Swinging Maestro', 'swinging'), 0);
  assert(Number.isFinite(fuzzyScore('Swinging Maestro', 'swng mst')));
  assert.equal(fuzzyScore('Élan 123', 'elan'), 0);
  assert(Number.isFinite(fuzzyScore('Skill 200351', '200351')));
  assert.equal(fuzzyScore('Swinging Maestro', 'xyz'), Infinity);
});

test('hidden screenshot drafts are ignored and survive saves in either race mode', async () => {
  const scan = { points: 200, observations: [{ id: 2, owned: true, level: 1, price: null, hint: null }], ignored: [], selected: [] };
  stored = { input: { screenshotImport: scan }, draftInput: { screenshotImport: scan }, buildTab: 'scanned-skills' };
  const hidden = { ...catalog, screenshot_import_enabled: false, screenshot_skills: { 2: { cost: 180, tier: null } } };
  const memory = await loadStaminaMemory(hidden);
  assert.equal(memory.buildTab, 'skills');
  assert.equal(memory.input.screenshotImport, undefined);
  assert.equal(memory.draftInput.screenshotImport, undefined);
  assert.equal(memory.input.build.skills.length, 0);
  memory.input.build.stats.stamina = 777;
  await saveStaminaMemory(memory, false);
  const enabled = { ...hidden, screenshot_import_enabled: true };
  const restored = await loadStaminaMemory(enabled);
  assert.deepEqual(plain(restored.input.screenshotImport), scan);
  assert.deepEqual(plain(restored.draftInput.screenshotImport), scan);
  assert.equal(restored.input.build.stats.stamina, 777);
  delete restored.input.screenshotImport;
  await saveStaminaMemory(restored, true);
  assert.equal((await loadStaminaMemory(enabled)).input.screenshotImport, undefined);
});

test('Undo import restores the previous build and selected scan after a reload', () => {
  const scan = { points: 200, observations: [{ id: 2, owned: false, level: null, price: 180, hint: null }], ignored: [], selected: [2] };
  const enabled = { ...catalog, umas: [], screenshot_import_enabled: true, screenshot_skills: { 2: { cost: 180, tier: null } } };
  const prior = restoreStaminaMemory({ input: { screenshotImport: scan } }, enabled).input;
  const applied = applyScreenshotBuild(prior, { stats: { ...prior.build.stats, stamina: 720 } }, { ...scan, selected: [] });
  const restored = restoreStaminaMemory({ input: plain(applied) }, enabled).input;
  restored.target = 95;
  const undone = undoScreenshotBuild(restored);
  assert.deepEqual(plain(undone.build), plain(prior.build));
  assert.deepEqual(plain(undone.screenshotImport), scan);
  assert.equal(undone.target, 95);
  assert.equal(undone.importUndo, undefined);
  const ipc = types.staminaEngineInput(restored);
  assert(!('importUndo' in ipc) && !('usesDefaultStamina' in ipc.build));
});
