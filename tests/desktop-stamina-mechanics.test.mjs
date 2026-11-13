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
const { restoreStaminaMemory, saveStaminaMemory } = module('../apps/desktop/src/staminaState.ts', {
  './staminaScreenshot': module('../apps/desktop/src/staminaScreenshot.ts'),
  './staminaTypes': types, '@tauri-apps/plugin-store': { load: async path => { assert.equal(path, 'stamina.json'); return store; } }
});
const catalog = { courses: [{ id: 'hanshin' }], skills: [{ id: 1, rarity: 'unique' }, { id: 2, rarity: 'gold' }] };



for (const mechanicsDefaults of [undefined, 1, '2', 2]) {
  for (const key of ['input', 'draftInput']) {
    test(key + ' migrates mechanics only without numeric version 2: ' + JSON.stringify(mechanicsDefaults), () => {
      const savedInput = { ...structuredClone(types.defaultStaminaInput), spot_struggle: false, dueling: false, rushed: false, lane_movement: false, assume_skills_activate: false };
      const restored = restoreStaminaMemory({ mechanicsDefaults, [key]: savedInput }, catalog)[key];
      assert.equal(restored.spot_struggle, mechanicsDefaults !== 2);
      assert.equal(restored.dueling, mechanicsDefaults !== 2);
      assert.equal(restored.rushed, false);
      assert.equal(restored.lane_movement, false);
      assert.equal(restored.assume_skills_activate, false);
    });
  }
}
test('every save writes marker 2 and preserves explicit choices on reload', async () => {
  const memory = restoreStaminaMemory(undefined, catalog);
  memory.input.spot_struggle = false;
  memory.draftInput = { ...structuredClone(memory.input), dueling: false };
  await saveStaminaMemory(memory);
  const [key, saved] = writes.at(-1);
  assert.equal(key, 'last-inputs-v1');
  assert.equal(saved.mechanicsDefaults, 2);
  assert.equal(memory.mechanicsDefaults, undefined);
  const restored = restoreStaminaMemory(saved, catalog);
  assert.equal(restored.input.spot_struggle, false);
  assert.equal(restored.draftInput.dueling, false);
});
