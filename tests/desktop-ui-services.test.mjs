import test from './support/clock-test.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { apiHarness, players, waitUntil } from './support/helpers.mjs';

const source = fs.readFileSync(new URL('../apps/desktop/src/services.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function services(imports) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, AbortController, Error, Map, require: name => imports[name] });
  return exports.desktopUiServices;
}

function coreServices(h) {
  return services({ '@umalytics/core/profiles/playerProfileApi': h.c });
}

test('desktop explorer forwards request, progress and cancellation signal to the existing core service', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const progress = () => {};
  const expected = { value: 1 };
  const ui = services({ '@umalytics/core/explorer/explorerService': {
    async executeExplorerRequest(...args) { calls.push(args); return expected; }
  } });
  assert.equal(await ui.loadHistoricalMatch('ABC123', signal), expected);
  assert.equal(await ui.searchPlayers('Sean', 2, signal), expected);
  assert.equal(await ui.loadSeasonLeaderboard(signal), expected);
  assert.equal(await ui.loadExplorerProfiles(players(2), 'allTime', progress, signal), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.map(([request]) => request))), [
    { kind: 'match', input: 'ABC123' }, { kind: 'search', input: 'Sean', page: 2 },
    { kind: 'leaderboard' }, { kind: 'profiles', players: players(2), scope: 'allTime' }
  ]);
  assert(calls.every(([, forwarded]) => forwarded === signal));
  assert.equal(calls[3][2], progress);
});

test('desktop explorer preserves the core rate-limit error and retry time', async () => {
  const ui = services({ '@umalytics/core/explorer/explorerService': {
    executeExplorerRequest: async () => { throw new Error('HTTP 429'); },
    explorerError: () => ({ message: 'API paused', retryAt: 123456 })
  } });
  await assert.rejects(ui.searchPlayers('Sean', 1, new AbortController().signal), error =>
    error.message === 'API paused' && error.retryAt === 123456);
});

test('desktop title cancellation by request ID aborts the underlying core fetch only for that ID', async () => {
  const h = apiHarness({ responder: url => url.pathname.endsWith('/profile') ? { hang: true } : undefined });
  const ui = coreServices(h);
  const first = ui.sendPlayerProfileRequest(players(2)[0].discordId, 'first');
  const second = ui.sendPlayerProfileRequest(players(2)[1].discordId, 'second');
  await waitUntil(() => h.calls.length === 2);
  const rejectedFirst = assert.rejects(first, /abort|cancel/i);
  await ui.cancelPlayerProfileRequest('first');
  await rejectedFirst;
  assert.equal(h.aborts, 1);
  const rejectedSecond = assert.rejects(second, /abort|cancel/i);
  await ui.cancelPlayerProfileRequest('second');
  await rejectedSecond;
  assert.equal(h.aborts, 2);
});

test('desktop history cancellation aborts a pending season lookup before starting history', async () => {
  const h = apiHarness({ responder: url => url.pathname === '/api/seasons' ? { hang: true } : undefined });
  const ui = coreServices(h);
  const pending = ui.sendPlayerHistoryPageRequest(players(1)[0].discordId, 'currentSeason', 1, 'history');
  await waitUntil(() => h.calls.length === 1);
  const rejected = assert.rejects(pending, /abort|cancel/i);
  await ui.cancelPlayerHistoryPageRequest('history');
  await rejected;
  assert.equal(h.aborts, 1);
  assert.deepEqual(h.calls, ['/api/seasons']);
});

test('desktop history cancellation aborts an in-flight history response', async () => {
  const h = apiHarness({ responder: url => url.pathname.endsWith('/history') ? { hang: true } : undefined });
  const ui = coreServices(h);
  const pending = ui.sendPlayerHistoryPageRequest(players(1)[0].discordId, 'allTime', 2, 'history');
  await waitUntil(() => h.calls.length === 1);
  const rejected = assert.rejects(pending, /abort|cancel/i);
  await ui.cancelPlayerHistoryPageRequest('history');
  await rejected;
  assert.equal(h.aborts, 1);
  assert.match(h.calls[0], /history\?page=2&pageSize=20&mode=ranked$/);
});

test('desktop title requests retain core response caching', async () => {
  const h = apiHarness({ responder: () => ({ body: { title: 'Champion' } }) });
  const ui = coreServices(h);
  const id = players(1)[0].discordId;
  assert.equal((await ui.sendPlayerProfileRequest(id, 'first')).title, 'Champion');
  assert.equal((await ui.sendPlayerProfileRequest(id, 'second')).title, 'Champion');
  assert.equal(h.calls.length, 1);
  await ui.cancelPlayerProfileRequest('first');
  assert.equal(h.aborts, 0);
});

test('desktop recent players preserve the extension storage key and shape through CorePlatform storage', async () => {
  const recent = [{ discordId: '123456789012345678', displayName: 'Sean' }];
  const saved = { playersRecentViewed: [...recent, { discordId: 1 }, null] };
  const ui = services({ '@umalytics/core/platform': { getCoreStorage: () => ({ local: {
    async get(key) { return { [key]: saved[key] }; },
    async set(values) { Object.assign(saved, values); }
  } }) } });
  assert.deepEqual(Array.from(await ui.getRecentPlayers()), recent);
  await ui.setRecentPlayers(recent);
  assert.deepEqual(saved, { playersRecentViewed: recent });
});

test('desktop recent-player storage failure does not break player lookup', async () => {
  const ui = services({ '@umalytics/core/platform': { getCoreStorage() { throw new Error('Store unavailable'); } } });
  assert.equal((await ui.getRecentPlayers()).length, 0);
  await ui.setRecentPlayers([]);
});
