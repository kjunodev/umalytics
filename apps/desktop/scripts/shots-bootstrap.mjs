import { draftSnapshotFixture } from '../../../tests/fixtures/stamina-draft.mjs';
import { mockIPC, mockWindows, mockConvertFileSrc } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { apiResponse, catalog, messages, staminaResult } from './shots-fixture.mjs';

const scene = window.__SHOT_SCENE__ ?? 'lobby';
const requests = new Map();
const stores = new Map([[1, 'shell.json'], [2, 'profiles.json']]);
const calls = [];
let id = 10;
let pending;
const draftMessage = (partial, version = 1001) => {
  const snapshot = draftSnapshotFixture(partial);
  const raw = m => ({ id: m.mapId, track: m.track, distance: m.distance, surface: m.surface, variant: m.variant, conditions: { ground: m.ground, weather: m.weather, season: m.season } });
  const side = team => ({ pickedMaps: snapshot.teams[team].maps.map(raw), bannedMaps: [], pickedUmas: [], bannedUmas: [], preBannedUmas: [] });
  return { v: 1, roomCode: 'ABC123', event: { type: 'match.snapshot', matchId: 'ABC123', version, state: { phase: snapshot.phase, team1: side('team1'), team2: side('team2'), wildcardMap: snapshot.tiebreakerMap ? raw(snapshot.tiebreakerMap) : undefined } } };
};
window.__SHOT_CONTROL__ = { calls, emit, draftMessage, messages, slow: false };
mockWindows('main');
mockConvertFileSrc('windows');
mockIPC(async (command, args) => {
  calls.push({ command, args: structuredClone(args) });
  if (command === 'plugin:app|version') return '0.1.0';
  if (command === 'plugin:store|load') { const existing = [...stores].find(([, path]) => path === args.path); if (existing) return existing[0]; const rid = ++id; stores.set(rid, args.path); return rid; }
  if (command === 'plugin:store|get') {
    const key = `shots:${stores.get(args.rid)}:${args.key}`;
    const value = localStorage.getItem(key);
    return [value ? JSON.parse(value) : undefined, value !== null];
  }
  if (command === 'plugin:store|set') { localStorage.setItem(`shots:${stores.get(args.rid)}:${args.key}`, JSON.stringify(args.value)); return; }
  if (command === 'plugin:store|delete') { localStorage.removeItem(`shots:${stores.get(args.rid)}:${args.key}`); return true; }
  if (command === 'plugin:store|save') return;
  if (command === 'plugin:window|set_always_on_top') return;
  if (command === 'plugin:window|inner_size') return { width: window.innerWidth * 1.25, height: window.innerHeight * 1.25 };
  if (command === 'plugin:window|scale_factor') return 1.25;
  if (command === 'plugin:window|set_size') { await window.__resizeShot__(args.value.toJSON().Logical); return; }
  if (command === 'start_feed') {
    if (!['empty', 'port-in-use', 'draft-loading', 'feed-error'].includes(scene)) setTimeout(async () => { for (const message of messages) await emit('feed-message', message); }, 0);
    return { state: scene === 'empty' ? 'listening' : scene === 'port-in-use' ? 'port-in-use' : scene === 'feed-error' ? 'error' : 'connected', accepted: scene === 'empty' ? 0 : messages.length, rejected: 0 };
  }
  if (command === 'engine_catalog') return scene === 'stamina-no-data' ? { ...catalog, local_skill_data: false, local_skill_count: 0, local_icon_count: 0, skills: catalog.skills.map(s => ({ ...s, icon_path: null })) } : catalog;
  if (command === 'stamina_check') {
    if (window.__SHOT_CONTROL__.failNext) { window.__SHOT_CONTROL__.failNext = false; throw new Error('Engine could not complete this check.'); }
    if (window.__SHOT_CONTROL__.slow) return new Promise((resolve, reject) => { pending = { resolve, reject }; void emit('stamina-progress', { request_id: args.input.request_id, completed: 100, total: 544, stage: 'mapping', percent: 15 }); });
    return staminaResult(args.input);
  }
  if (command === 'stamina_check_races') {
    const results = [];
    for (const [index, race] of args.input.races.entries()) {
      const { races: _races, ...input } = args.input;
      const result = staminaResult({ ...input, race }, index < 2 ? -400 : index * 20); results.push(result);
      await emit('stamina-progress', { request_id: input.request_id, map_id: race.map_id, stage: 'refining', percent: (index * 100 + 65) / args.input.races.length, race_index: index, race_total: args.input.races.length });
      await emit('stamina-race-result', { request_id: input.request_id, index, total: args.input.races.length, result });
      if (window.__SHOT_CONTROL__.slow && index === 1) return new Promise((resolve, reject) => { pending = { resolve, reject }; });
    }
    await emit('stamina-progress', { request_id: args.input.request_id, stage: 'done', percent: 100, race_index: results.length - 1, race_total: results.length });
    return results;
  }
  if (command === 'cancel_stamina_check') { pending?.reject('Simulation cancelled.'); pending = undefined; return; }
  if (command === 'plugin:http|fetch') { const rid = ++id; requests.set(rid, { url: args.clientConfig.url, body: apiResponse(args.clientConfig.url) }); return rid; }
  if (command === 'plugin:http|fetch_send') {
    if (scene === 'loading' && /\/stats\?/.test(requests.get(args.rid).url)) return new Promise(() => {});
    const fail = scene === 'profile-error' && /\/100000000000000301\/stats\?/.test(requests.get(args.rid).url);
    const privateStats = scene === 'private' && /\/100000000000000302\/stats\?/.test(requests.get(args.rid).url);
    return { status: privateStats ? 403 : fail ? 503 : 200, statusText: privateStats ? 'Forbidden' : fail ? 'Unavailable' : 'OK', url: requests.get(args.rid).url, headers: [['content-type', 'application/json']], rid: args.rid };
  }
  if (command === 'plugin:http|fetch_read_body') {
    const response = requests.get(args.rid);
    if (response.consumed) return [1];
    response.consumed = true;
    return [...new TextEncoder().encode(JSON.stringify(response.body)), 0];
  }
  if (command === 'plugin:http|fetch_cancel' || command === 'plugin:http|fetch_cancel_body') return;
  throw new Error(`Unmocked IPC: ${command}`);
}, { shouldMockEvents: true });
await import('../src/main.tsx');
