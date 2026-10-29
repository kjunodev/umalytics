import test from './support/clock-test.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import ts from 'typescript';

const coreUrl = new URL('../packages/core/src/', import.meta.url);
const corePath = fileURLToPath(coreUrl);
const files = fs.readdirSync(corePath, { recursive: true }).filter(file => file.endsWith('.ts'));

test('every core import stays within core or shared, without platform globals', () => {
  for (const file of files) {
    const absolute = path.join(corePath, file);
    const source = fs.readFileSync(absolute, 'utf8');
    assert.doesNotMatch(source, /browser\.|chrome\.|document|window|(?:from\s*|import\s*)['"]wxt/, file);
    const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of syntax.statements) {
      const specifier = statement.moduleSpecifier?.text;
      if (!specifier || specifier === '@umalytics/shared') continue;
      assert(specifier.startsWith('.'), `${file}: ${specifier}`);
      const target = path.resolve(path.dirname(absolute), `${specifier}.ts`);
      assert(!path.relative(corePath, target).startsWith('..'), `${file}: ${specifier} escapes core`);
      assert(fs.existsSync(target), `${file}: missing ${specifier}`);
    }
  }
});

test('real core imports restore unchanged caches, use global fetch, and initialize the extension adapter', async t => {
  // Keep ESM imports intact while compiling TS, so this exercises the actual
  // dependency graph rather than the isolated-function VM harness.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@umalytics/core') return nextResolve(new URL('index.ts', coreUrl).href, context);
      if (specifier.startsWith('@umalytics/core/')) return nextResolve(new URL(`${specifier.slice('@umalytics/core/'.length)}.ts`, coreUrl).href, context);
      if (specifier === 'wxt/browser') return { shortCircuit: true,
        url: 'data:text/javascript,export const browser = globalThis.__umalyticsCoreStorageFixture;' };
      if (context.parentURL?.startsWith(new URL('../', import.meta.url).href) && specifier.startsWith('.') && !path.extname(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (!url.startsWith(new URL('../', import.meta.url).href) || !url.endsWith('.ts')) return nextLoad(url, context);
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(fs.readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
      }).outputText };
    }
  });
  t.after(() => { hooks.deregister(); delete globalThis.__umalyticsCoreStorageFixture; });
  const platform = await import('../packages/core/src/index.ts');
  const api = await import('../packages/core/src/profiles/apiClient.ts');
  const profiles = await import('../packages/core/src/storage/profileStorage.ts');
  for (const file of files) await import(new URL(file.replaceAll('\\', '/'), coreUrl).href);

  const reads = [], writes = [], diagnostics = [];
  const profile = { discordId: '123456789012345678', fetchedAt: Date.now(), displayName: 'Saved' };
  const snapshot = { matchCode: 'ROOM01', profiles: { [profile.discordId]: profile } };
  const local = { profileArchiveV2: { [profile.discordId]: profile }, playerProfileSummariesV2: snapshot };
  const session = { profileApiResponsesV1: { '/api/seasons': { value: [{ id: 'saved' }], expiresAt: Date.now() + 60_000 } } };
  const area = (name, data) => ({
    async get(key) { reads.push([name, key]); return { [key]: structuredClone(data[key]) }; },
    async set(values) { writes.push([name, structuredClone(values)]); Object.assign(data, structuredClone(values)); },
    async remove(key) { delete data[key]; }
  });
  platform.configureCorePlatform({ storage: { local: area('local', local), session: area('session', session) },
    recordDiagnostic: value => diagnostics.push(value) });
  assert.deepEqual(await api.fetchJson('/api/seasons'), [{ id: 'saved' }]);
  assert.deepEqual(await profiles.getCachedPlayerProfiles(), { [profile.discordId]: profile });
  assert.deepEqual(await profiles.getPlayerProfileSummaries(), snapshot);
  const next = { ...snapshot, fetchedAt: 123 };
  await profiles.setPlayerProfileSummaries(next);
  assert.deepEqual(local.playerProfileSummariesV2, next);
  await profiles.rememberCachedPlayerProfiles({ [profile.discordId]: { ...profile, displayName: 'Updated' } });
  assert.equal(local.profileArchiveV2[profile.discordId].displayName, 'Updated');
  assert.deepEqual(reads, [['session', 'profileApiResponsesV1'], ['local', 'profileArchiveV2'], ['local', 'playerProfileSummariesV2']]);
  assert(diagnostics.some(value => value.kind === 'cache' && value.reason === 'hit'));

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url.href, 'https://drafter-api.uma.guide/api/players/123456789012345678/profile');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.cache, 'no-store');
      assert(init.signal instanceof AbortSignal);
      return new Response(JSON.stringify({ displayName: 'Network' }));
    };
    assert.deepEqual(await api.fetchJson('/api/players/123456789012345678/profile'), { displayName: 'Network' });
    const deadline = Date.now() + 2000;
    while (!writes.some(([name]) => name === 'session')) {
      assert(Date.now() < deadline, 'session response cache was not persisted');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(session.profileApiResponsesV1['/api/players/123456789012345678/profile'].value, { displayName: 'Network' });
  } finally { globalThis.fetch = originalFetch; }
  const cooldown = { until: Date.now() + 5000, status: 429, path: '/api/seasons', startIntervalMs: 700 };
  api.restoreApiCooldown(cooldown);
  assert.deepEqual(api.getApiCooldown(), cooldown);
  await assert.rejects(api.fetchJson('/api/uncached'), /API paused after HTTP 429/);

  // Import the production wrapper, as the scout page does, and verify it
  // configures the host storage before a persisted read.
  const extensionLocal = { playerProfileSummariesV2: snapshot };
  const extensionArea = {
    async get(key) { assert.equal(this, extensionArea); return { [key]: extensionLocal[key] }; },
    async set(values) { assert.equal(this, extensionArea); Object.assign(extensionLocal, values); },
    async remove(key) { assert.equal(this, extensionArea); delete extensionLocal[key]; }
  };
  globalThis.__umalyticsCoreStorageFixture = { storage: { local: extensionArea, session: undefined } };
  const extensionProfiles = await import('../apps/extension/storage/profileStorage.ts');
  assert.deepEqual(await extensionProfiles.getPlayerProfileSummaries(), snapshot);
  await extensionProfiles.setPlayerProfileSummaries(next);
  assert.deepEqual(extensionLocal.playerProfileSummariesV2, next);
});
