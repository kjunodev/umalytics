import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function module(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`../apps/desktop/src/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: name => imports[name], Date, Set, Error });
  return exports;
}
const stateModule = module('updateState');
const { updateState, updateBanner, roomIsActive, installAfterRoom } = stateModule;
const { createUpdateController, scheduleUpdateChecks } = module('updateController', { './updateState': stateModule });
const found = (version = '0.2.0') => ({ type: 'found', version, notes: 'Release notes', at: 1000 });
const ready = () => updateState(updateState({ phase: 'idle' }, found()), { type: 'downloaded' });

test('download, ready, room deferral, install and error banner states', () => {
  let state = { phase: 'idle' };
  assert.equal(updateBanner(state, false), 'hidden');
  state = updateState(state, { type: 'check' });
  assert.equal(updateBanner(state, true), 'hidden');
  state = updateState(state, found());
  assert.equal(updateBanner(state, true), 'downloading');
  state = updateState(state, { type: 'downloaded' });
  assert.equal(updateBanner(state, false), 'ready');
  assert.equal(updateBanner(state, true), 'deferred');
  assert(installAfterRoom(state, true, false));
  assert(!installAfterRoom(state, false, false));
  assert(!installAfterRoom(state, true, true));
  state = updateState(state, { type: 'install' });
  assert.equal(updateBanner(state, false), 'installing');
  assert(!installAfterRoom(state, true, false));
  state = updateState(state, { type: 'failed', error: 'offline' });
  assert.equal(updateBanner(state, false), 'error');
});

test('only a connected feed with an active code defers; retained last-room state does not', () => {
  assert(roomIsActive('connected', 'ABC123'));
  for (const [feed, code] of [['disconnected', 'ABC123'], ['listening', 'ABC123'], ['connected', undefined], [undefined, 'ABC123']]) assert(!roomIsActive(feed, code));
});

test('dismissal lasts for that version only and resets with a new launch', () => {
  let state = updateState(ready(), { type: 'dismiss' });
  assert.equal(updateBanner(state, true), 'hidden');
  state = updateState(state, found());
  assert.equal(updateBanner(state, false), 'hidden');
  state = updateState(state, found('0.3.0'));
  assert.equal(updateBanner(state, false), 'downloading');
  assert.equal(updateBanner(ready(), false), 'ready');
});

test('automatic check failures are silent and retain a Settings error and timestamp', () => {
  const state = updateState({ phase: 'checking' }, { type: 'failed', error: 'offline', automaticCheck: true, at: 42 });
  assert.equal(updateBanner(state, false), 'hidden');
  assert.equal(state.error, 'offline'); assert.equal(state.lastChecked, 42);
});

test('controller coalesces checks, downloads immediately, and installs only on request', async () => {
  const calls = [];
  let finish;
  const controller = createUpdateController({ check: async () => { calls.push('check'); return { version: '0.2.0', body: 'Notes', close: async () => {}, download: () => { calls.push('download'); return new Promise(resolve => { finish = resolve; }); }, install: async () => { calls.push('install'); } }; }, restart: async () => { calls.push('restart'); } }, () => 42);
  const first = controller.check(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.snapshot().phase, 'downloading');
  await controller.check(); await controller.install();
  assert.deepEqual(calls, ['check', 'download']);
  finish(); await first;
  assert.equal(controller.snapshot().notes, 'Notes');
  assert.equal(controller.snapshot().phase, 'ready');
  await controller.install(); await controller.install();
  assert.deepEqual(calls, ['check', 'download', 'install', 'restart']);
});

test('failed automatic downloads show Retry; retries release resources and recheck', async () => {
  let attempts = 0, closed = 0;
  const controller = createUpdateController({ check: async () => ({ version: '0.2.0', close: async () => { closed++; }, download: async () => { if (++attempts === 1) throw Error('download failed'); }, install: async () => {} }), restart: async () => {} });
  await controller.check(true);
  assert.equal(updateBanner(controller.snapshot(), false), 'error');
  await controller.check(); assert.equal(closed, 1);
  assert.equal(controller.snapshot().phase, 'ready');
});

test('dismissed ready updates still discover newer versions without re-downloading the same one', async () => {
  let version = '0.2.0', downloads = 0, installs = 0;
  const controller = createUpdateController({ check: async () => ({ version, close: async () => {}, download: async () => { downloads++; }, install: async () => { installs++; } }), restart: async () => {} });
  await controller.check(); controller.dismiss();
  await controller.check(true);
  assert.equal(downloads, 1); assert.equal(updateBanner(controller.snapshot(), false), 'hidden');
  version = '0.3.0'; await controller.check(true);
  assert.equal(downloads, 2); assert.equal(updateBanner(controller.snapshot(), false), 'ready');
  assert.equal(installs, 0);
});

test('automatic checks run at 10s and every 6h and cancel when disabled', () => {
  const calls = [], cleared = [];
  const clock = { setTimeout: (fn, ms) => { calls.push([fn, ms]); return 1; }, setInterval: (fn, ms) => { calls.push([fn, ms]); return 2; }, clearTimeout: id => cleared.push(id), clearInterval: id => cleared.push(id) };
  let checked = 0;
  const stop = scheduleUpdateChecks(() => checked++, clock);
  assert.deepEqual(calls.map(([, ms]) => ms), [10_000, 21_600_000]);
  calls.forEach(([fn]) => fn()); assert.equal(checked, 2);
  stop(); assert.deepEqual(cleared, [1, 2]);
});

test('automatic updates default on, survive storage, and honor opt-out', async () => {
  let saved, written;
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL('../apps/desktop/src/preferences.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, structuredClone, require: () => ({ load: async () => ({ get: async () => saved, set: async (_, value) => { written = value; }, save: async () => {} }) }) });
  await exports.loadPreferences(); assert.equal(exports.preferences.automaticUpdates, true);
  await exports.savePreferences({ automaticUpdates: false }); assert.equal(written.automaticUpdates, false);
  saved = written; await exports.loadPreferences(); assert.equal(exports.preferences.automaticUpdates, false);
});
