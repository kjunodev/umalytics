import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function moduleWithMocks(file, imports, extra = {}) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, require: name => imports[name], structuredClone, AbortController, URL, ...extra });
  return exports;
}

test('Live migration preserves all legacy tabs and manual choice lasts until a phase change', async () => {
  let saved;
  const p = moduleWithMocks('../apps/desktop/src/preferences.ts', { '@tauri-apps/plugin-store': { load: async () => ({ get: async () => saved }) } });
  for (const tab of ['Lobby', 'Draft', 'Umas']) {
    saved = { page: tab }; await p.loadPreferences();
    assert.equal(p.preferences.page, 'Live'); assert.equal(p.preferences.liveTab, tab);
  }
  assert.equal(p.phaseLiveTab('Umas', undefined, 'lobby'), 'Umas');
  assert.equal(p.phaseLiveTab('Umas', 'lobby', 'lobby'), 'Umas');
  assert.equal(p.phaseLiveTab('Umas', 'lobby', 'uma-pick'), 'Draft');
  assert.equal(p.phaseLiveTab('Draft', 'complete', 'lobby'), 'Lobby');
});

test('leaderboard session cache coalesces requests, survives revisits, refreshes and expires after ten minutes', async () => {
  let now = 1000, calls = 0;
  const m = moduleWithMocks('../apps/desktop/src/sessionData.ts', {
    './services': { desktopUiServices: { loadSeasonLeaderboard: async () => { calls++; return { entries: [calls] }; } } },
    '@umalytics/core/platform': {}, '@umalytics/core/profiles/esportsTeamApi': {}
  }, { Date: { now: () => now } });
  await Promise.all([m.loadDesktopLeaderboard(), m.loadDesktopLeaderboard()]); assert.equal(calls, 1);
  assert.equal(m.cachedLeaderboard().fetchedAt, now);
  await m.loadDesktopLeaderboard(); assert.equal(calls, 1);
  await m.loadDesktopLeaderboard(true); assert.equal(calls, 2);
  now += 10 * 60 * 1000; await m.loadDesktopLeaderboard(); assert.equal(calls, 3);
});

test('team icons use the 24h persistent cache, load once per session, and retain stale data on failure', async () => {
  for (const stale of [false, true]) {
    let calls = 0;
    const map = { fixture: { teamId: 't', teamName: 'Fixture team', logoUrl: 'https://drafter.uma.guide/logo.png' } };
    const m = moduleWithMocks('../apps/desktop/src/sessionData.ts', {
      './services': {}, '@umalytics/core/platform': { getCoreStorage: () => ({ local: { get: async key => ({ [key]: { map, fetchedAt: stale ? 0 : 100000000 } }) } }) },
      '@umalytics/core/profiles/esportsTeamApi': { fetchTeamIconMap: async () => { calls++; throw Error('offline'); } }
    }, { Date: { now: () => 100000001 } });
    assert.deepEqual(await m.loadDesktopTeamIcons(), map);
    await m.loadDesktopTeamIcons(); assert.equal(calls, stale ? 1 : 0);
  }
});

test('external URLs use the opener and are limited to the exact Drafter HTTPS origin', async () => {
  const opened = [];
  const m = moduleWithMocks('../apps/desktop/src/externalLinks.ts', { '@tauri-apps/plugin-opener': { openUrl: async url => opened.push(url) } });
  await m.openDrafterUrl('https://drafter.uma.guide/matches/ABC123');
  for (const url of ['http://drafter.uma.guide/matches/ABC123', 'https://drafter.uma.guide.evil/', 'https://secret@drafter.uma.guide/']) await assert.rejects(m.openDrafterUrl(url));
  assert.deepEqual(opened, ['https://drafter.uma.guide/matches/ABC123']);
  const capabilities = JSON.parse(fs.readFileSync(new URL('../apps/desktop/src-tauri/capabilities/main.json', import.meta.url)));
  assert.deepEqual(capabilities.permissions.find(p => p.identifier === 'opener:allow-open-url').allow, [{ url: 'https://drafter.uma.guide/*' }]);
  assert(!capabilities.permissions.includes('opener:default'));
});
