import { mockIPC, mockWindows, mockConvertFileSrc } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { apiResponse, catalog, messages, staminaResult } from './shots-fixture.mjs';

const scene = window.__SHOT_SCENE__ ?? 'lobby';
const requests = new Map();
const stores = new Map([[1, 'shell.json'], [2, 'profiles.json']]);
const calls = [];
let id = 10;
let pending;
window.__SHOT_CONTROL__ = { calls, emit, slow: false };
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
    if (scene !== 'empty') setTimeout(async () => { for (const message of messages) await emit('feed-message', message); }, 0);
    return { state: scene === 'empty' ? 'listening' : 'connected', accepted: scene === 'empty' ? 0 : messages.length, rejected: 0 };
  }
  if (command === 'engine_catalog') return scene === 'stamina-no-data' ? { ...catalog, local_skill_data: false, skills: catalog.skills.map(s => ({ ...s, global: true, icon_path: null })) } : catalog;
  if (command === 'stamina_check') {
    if (window.__SHOT_CONTROL__.slow) return new Promise((resolve, reject) => { pending = { resolve, reject }; void emit('stamina-progress', { request_id: args.input.request_id, completed: 100, total: 544, stage: 'mapping', percent: 15 }); });
    return staminaResult(args.input);
  }
  if (command === 'cancel_stamina_check') { pending?.reject('Simulation cancelled.'); pending = undefined; return; }
  if (command === 'plugin:http|fetch') { const rid = ++id; requests.set(rid, { url: args.clientConfig.url, body: apiResponse(args.clientConfig.url) }); return rid; }
  if (command === 'plugin:http|fetch_send') return { status: 200, statusText: 'OK', url: requests.get(args.rid).url, headers: [['content-type', 'application/json']], rid: args.rid };
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
