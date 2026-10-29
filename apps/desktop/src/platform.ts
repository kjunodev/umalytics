import { getVersion } from '@tauri-apps/api/app';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { load } from '@tauri-apps/plugin-store';
import { configureCorePlatform, type KeyValueStorage } from '@umalytics/core';

export async function initializePlatform(): Promise<void> {
  const [store, version] = await Promise.all([
    load('profiles.json', { autoSave: false, defaults: {} }), getVersion()
  ]);
  const local: KeyValueStorage = {
    async get(key) { return { [key]: await store.get(key) }; },
    async set(values) {
      for (const [key, value] of Object.entries(values)) await store.set(key, value);
      await store.save();
    },
    async remove(key) { await store.delete(key); await store.save(); }
  };
  const session = new Map<string, unknown>();
  configureCorePlatform({ storage: { local, session: {
    async get(key) { return { [key]: structuredClone(session.get(key)) }; },
    async set(values) { for (const [key, value] of Object.entries(values)) session.set(key, structuredClone(value)); },
    async remove(key) { session.delete(key); }
  } }, fetch: (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== 'https://drafter-api.uma.guide') throw new Error('API origin is not allowed.');
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', `UmaLytics-Desktop/${version}`);
    return tauriFetch(input, { ...init, headers, maxRedirections: 0 });
  } });
}
