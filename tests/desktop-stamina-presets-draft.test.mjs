import test from 'node:test';
import { draftSnapshotFixture } from './fixtures/stamina-draft.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import bundled from '../apps/desktop/src-tauri/data/role-kits.json' with { type: 'json' };
import pool from '../apps/desktop/src-tauri/data/drafter-map-pool-global.json' with { type: 'json' };

function module(path, imports = {}) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, structuredClone, require: name => imports[name] });
  return exports;
}
const types = module('../apps/desktop/src/staminaTypes.ts');
const state = module('../apps/desktop/src/staminaState.ts', { './staminaTypes': types });
const presets = module('../apps/desktop/src/staminaPresetState.ts', { './staminaTypes': types, './staminaState': state, '../src-tauri/data/role-kits.json': { default: bundled } });
const draft = module('../apps/desktop/src/staminaDraft.ts', { './staminaTypes': types });
const catalog = { courses: pool.maps.map(m => ({ ...m, track_name: m.track, surface: m.surface === 'Turf' ? 1 : 2 })),
  skills: [...new Set(Object.values(bundled).filter(Array.isArray).flat()), 202051, 210052, 201241].map(id => ({ id, rarity: 'white' })).concat([{ id: 1, rarity: 'unique' }]) };
const plain = v => JSON.parse(JSON.stringify(v));
function snapshot(maps = []) { return { source: 'synced-draft-state', updatedAt: 1, teams: { team1: { id: 'team1', maps, umas: [] }, team2: { id: 'team2', maps: [], umas: [] } } }; }
const map = (course = pool.maps[0]) => ({ mapId: course.id, track: course.track, distance: course.distance, surface: course.surface, variant: course.variant, status: 'selected', team: 'team1', name: 'Fixture race', ground: 'Firm', weather: 'Cloudy', season: 'Winter' });

test('draft chooses selected races and tiebreaker, resolves IDs before metadata and excludes vetoes', () => {
  const selected = map(), snap = snapshot([selected, { ...map(), status: 'vetoed' }, { ...map(), status: 'unknown' }]);
  snap.tiebreakerMap = { ...map(pool.maps[1]), mapId: undefined };
  snap.teams.team2.maps.push(map(pool.maps[2]));
  const races = draft.draftRaces(snap, catalog);
  assert.equal(races.length, 3);
  assert.deepEqual(plain(races[0].race), { map_id: selected.mapId, ground_condition: 1, weather: 2, season: 4 });
  assert.equal(races[2].race.map_id, pool.maps[1].id);
  assert.equal(draft.draftRaces(undefined, catalog).length, 0);
  selected.track = 'Bad metadata';
  assert.equal(draft.draftRaces(snap, catalog)[0].race.map_id, selected.mapId);
});

test('draft does not guess unknown courses, variants, ambiguous courses or missing conditions', () => {
  for (const broken of [{ ...map(), mapId: 'missing', track: 'Unknown' }, { ...map(), mapId: undefined, variant: 'Unknown' }, { ...map(), ground: '' }, { ...map(), weather: 'Fog' }]) assert.equal(draft.draftRaces(snapshot([broken]), catalog)[0].race, undefined);
  const c = catalog.courses[0];
  assert.equal(draft.draftRaces(snapshot([{ ...map(), mapId: undefined }]), { ...catalog, courses: [c, { ...c, id: 'duplicate' }] })[0].label, 'Unknown course');
  for (let i = 0; i < 4; i++) {
    const r = draft.draftRaces(snapshot([{ ...map(), ground: types.groundNames[i], weather: types.weatherNames[i], season: types.seasonNames[i] }]), catalog)[0].race;
    assert.deepEqual([r.ground_condition, r.weather, r.season], [i + 1, i + 1, i + 1]);
  }
});

test('draft fingerprint ignores unrelated feed updates and detects conditions, races and room changes', () => {
  const s = snapshot([map()]), fingerprint = () => draft.draftFingerprint(s, draft.draftRaces(s, catalog)), before = fingerprint();
  s.updatedAt++; s.phase = 'uma-pick'; s.teams.team1.umas.push({ name: 'Fixture' });
  assert.equal(fingerprint(), before);
  s.teams.team1.maps[0].weather = 'Rainy'; assert.notEqual(fingerprint(), before);
  const changed = fingerprint(); s.matchCode = 'ABC123'; assert.notEqual(fingerprint(), changed);
});

test('manual course choice is explicit, scoped to the match and keeps live draft conditions', () => {
  const unknown = { ...map(), mapId: 'unknown', track: 'Fuchu' };
  const snap = { ...snapshot([unknown]), matchCode: 'ABC123' };
  const unresolved = draft.draftRaces(snap, catalog)[0];
  assert.equal(unresolved.race, undefined);
  const choices = { ABC123: { [unresolved.choiceKey]: pool.maps[1].id } };
  assert.equal(draft.draftRaces(snap, catalog, choices)[0].race.map_id, pool.maps[1].id);
  unknown.ground = 'Heavy'; unknown.weather = 'Rainy'; unknown.season = 'Summer';
  unknown.details = 'Heavy · Rainy · Summer';
  assert.deepEqual(plain(draft.draftRaces(snap, catalog, choices)[0].race), { map_id: pool.maps[1].id, ground_condition: 4, weather: 3, season: 2 });
  assert.equal(draft.draftRaces({ ...snap, matchCode: 'XYZ789' }, catalog, choices)[0].race, undefined);
  assert.equal(draft.draftRaces({ ...snap, matchCode: undefined }, catalog, choices)[0].race, undefined);
  assert.equal(draft.draftRaces(snap, catalog, { ABC123: { [unresolved.choiceKey]: 'not-in-pool' } })[0].race, undefined);
  unknown.weather = 'Fog';
  assert.equal(draft.draftRaces(snap, catalog, choices)[0].reason, 'Unknown or missing conditions');
  const known = { ...snapshot([map()]), matchCode: 'ABC123' };
  assert.equal(draft.draftRaces(known, catalog, choices)[0].race.map_id, pool.maps[0].id);
});

test('ballpark uses each kit, keeps stamina and clears user uniques; Runaway is Front plus 202051', () => {
  const memory = presets.restorePresets(undefined, catalog), current = structuredClone(types.defaultStaminaInput.build);
  current.stats.stamina = 1190; current.skills = [{ id: 1, level: 6 }];
  presets.roles.forEach((role, i) => {
    const b = presets.ballparkBuild(role, memory, current);
    assert.deepEqual(plain(b.stats), { speed: 1600, stamina: 1190, pow: 1200, guts: 600, wiz: 1200 });
    assert.equal(types.strategy(b), i + 1); assert.equal(b.motivation, 5);
    assert(b.skills.every(s => s.id !== 1));
    assert.deepEqual(plain(b.skills.map(s => s.id)), [...bundled[role], ...(role === 'runaway' ? [202051] : [])]);
  });
  const runaway = presets.ballparkBuild('runaway', memory, current);
  assert.equal(runaway.running_style, 1);
  assert(!types.withStrategy(runaway, 1).skills.some(s => s.id === 202051));
});

test('presets validate corrupt data, preserve empty kit overrides and keep bundled updates separate', () => {
  const memory = presets.restorePresets({ kits: { front: [], pace: [200331, 200331, 999, 1] }, defaults: { stats: { speed: 1550, pow: 9000 } }, builds: [{ id: 'one', name: '  Saved  ', build: { stats: { stamina: 1234 }, skills: [{ id: 999 }, { id: 1, level: 6 }] } }, { id: 'one', name: 'Duplicate' }, null] }, catalog);
  assert.deepEqual(plain(memory.kits), { front: [], pace: [200331] });
  assert.equal(memory.defaults.stats.speed, 1550); assert.equal(memory.defaults.stats.pow, 1200);
  assert.equal(memory.builds.length, 1); assert.equal(memory.builds[0].name, 'Saved');
  assert.equal(memory.builds[0].build.stats.stamina, 1234);
  assert.deepEqual(plain(memory.builds[0].build.skills), [{ id: 1, level: 6 }]);
  assert.equal(presets.ballparkBuild('front', memory, types.defaultStaminaInput.build).skills.length, 0);
  assert.equal(memory.kits.late, undefined);
});

test('old showAll state is discarded; target and draft inputs restore independently', () => {
  const restored = state.restoreStaminaMemory({ showAll: true, input: { target: 95, build: { stats: { stamina: 700 }, skills: [{ id: 201241 }, { id: 210052 }] } }, draftInput: { target: 99, build: { stats: { stamina: 1500 } } } }, catalog);
  assert.equal('showAll' in restored, false); assert.equal(restored.input.target, 95);
  assert.equal(restored.input.build.stats.stamina, 700); assert.equal(restored.draftInput.target, 99);
  assert.equal(restored.draftInput.build.stats.stamina, 1500); assert.equal(restored.input.build.skills.length, 2);
  assert.equal(state.restoreStaminaMemory({ input: { target: 100 } }, catalog).input.target, 90);
});

test('seven-race screenshot fixture resolves the full pool and partial draft stays partial', () => {
  const full = draft.draftRaces(draftSnapshotFixture(), catalog);
  assert.equal(full.length, 7); assert(full.every(r => r.race));
  assert.equal(draft.draftRaces(draftSnapshotFixture(true), catalog).length, 1);
});
