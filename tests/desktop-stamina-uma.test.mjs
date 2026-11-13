import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import kits from '../apps/desktop/src-tauri/data/role-kits.json' with { type: 'json' };

function load(name, imports = {}) {
  const source = readFileSync(new URL(`../apps/desktop/src/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, structuredClone, require: id => imports[id] });
  return exports;
}

const types = load('staminaTypes');
const state = load('staminaState', { './staminaTypes': types, './staminaScreenshot': load('staminaScreenshot') });
const presets = load('staminaPresetState', { './staminaTypes': types, './staminaState': state, '../src-tauri/data/role-kits.json': { default: kits } });
const specialWeek = { card_id: 100101, unique_skill_id: 100011, aptitudes: { distance: [2, 5, 7, 7], style: [1, 7, 7, 5], ground: [7, 1] } };
const ines = { card_id: 103102, unique_skill_id: 110311 };
const ordinary = { id: 200001, level: 1 };
const catalog = { courses: [], umas: [specialWeek, ines], skills: [
  { id: 100011, rarity: 'unique' }, { id: 110311, rarity: 'unique' }, { id: 200001, rarity: 'white' },
] };
const plain = value => JSON.parse(JSON.stringify(value));
const defaultBuild = types.defaultStaminaInput.build;

test('choosing an Uma sets only its unique and No Uma clears it', () => {
  const start = { ...defaultBuild, skills: [ordinary] };
  const selected = state.selectUma(start, specialWeek, catalog);
  assert.equal(selected.umaCardId, 100101);
  assert.deepEqual(plain(selected.skills), [ordinary, { id: 100011, level: 4 }]);
  for (const key of ['distance', 'style', 'ground']) assert.equal(selected[key], start[key]);

  const switched = state.selectUma({ ...selected, skills: [ordinary, { id: 100011, level: 6 }] }, ines, catalog);
  assert.equal(switched.umaCardId, 103102);
  assert.deepEqual(plain(switched.skills), [ordinary, { id: 110311, level: 6 }]);
  const cleared = state.selectUma(switched, undefined, catalog);
  assert.equal(cleared.umaCardId, undefined);
  assert.deepEqual(plain(cleared.skills), [ordinary]);
});

test('memory and saved builds validate card IDs and restore the selected unique', () => {
  const build = { ...defaultBuild, umaCardId: 103102, skills: [ordinary, { id: 100011, level: 5 }, { id: 110311, level: 6 }] };
  const draftBuild = { ...build, umaCardId: 100101 };
  const restored = state.restoreStaminaMemory({ input: { build }, draftInput: { build: draftBuild } }, catalog);
  assert.equal(restored.input.build.umaCardId, 103102);
  assert.deepEqual(plain(restored.input.build.skills), [ordinary, { id: 110311, level: 6 }]);
  assert.equal(restored.draftInput.build.umaCardId, 100101);
  assert.deepEqual(plain(restored.draftInput.build.skills), [ordinary, { id: 100011, level: 5 }]);
  assert.equal(Object.hasOwn(types.staminaEngineInput(restored.input).build, 'umaCardId'), false);
  assert.equal(Object.hasOwn(types.staminaEngineInput(restored.draftInput).build, 'umaCardId'), false);

  const saved = presets.restorePresets({ builds: [
    { id: 'valid', name: 'Valid', build },
    { id: 'invalid', name: 'Invalid', build: { ...build, umaCardId: 999999 } },
    { id: 'legacy', name: 'Legacy', build: { skills: [{ id: 100011, level: 3 }] } },
  ] }, catalog);
  assert.deepEqual(plain(saved.builds[0].build), plain(restored.input.build));
  assert.equal(saved.builds[1].build.umaCardId, undefined);
  assert.deepEqual(plain(saved.builds[1].build.skills), [ordinary]);
  assert.equal(saved.builds[2].build.umaCardId, 100101);
  assert.equal(saved.builds[2].build.skills[0].level, 3);
});

test('ballpark keeps the Uma and unique level within the Runaway skill limit', () => {
  const build = { ...defaultBuild, umaCardId: 103102, skills: [{ id: 110311, level: 6 }] };
  const memory = presets.restorePresets(undefined, catalog);
  memory.kits.runaway = Array.from({ length: 99 }, (_, i) => 300000 + i);
  const ballpark = presets.ballparkBuild('runaway', memory, build, ines);
  assert.equal(ballpark.umaCardId, 103102);
  assert.equal(ballpark.skills.length, 100);
  assert.deepEqual(plain(ballpark.skills.slice(-2)), [{ id: 110311, level: 6 }, { id: 202051, level: 1 }]);
});
