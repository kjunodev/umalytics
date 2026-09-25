import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModule } from './support/harness.mjs';

const ids = Array.from({ length: 10 }, (_, index) => String(100000000000000000n + BigInt(index)));
const players = count => ids.slice(0, count).map((discordId, index) => ({ discordId, displayName: `Roster ${index}` }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(predicate, timeoutMs = 1500) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for fixture condition');
    await sleep(5);
  }
}
const stats = () => ({ summary: { matchesIncluded: 4, totalPointsScored: 12, totalPodiumPlacements: 5, totalMvpMatches: 1 },
  umaEntries: [{ umaId: '100101', matches: 4, wins: 3, losses: 1, pointsScored: 12, podiumPlacements: 5, mvpMatches: 1 }] });
const historySummary = () => ({ wins: 99, losses: 88, pointsScored: 999, podiumPlacements: 77,
  firstPlaceFinishes: 7, secondPlaceFinishes: 7, thirdPlaceFinishes: 7, mvpAwards: 55 });
const entry = (index, verificationState = 'confirmed', isWinner = true) => ({ matchId: `FAKE-${index}`, reportedAt: '2026-01-01T00:00:00Z',
  mode: 'ranked', verificationState, selectedUmaId: index === 2 ? null : '100101', isWinner,
  pointsScored: 999, podiumPlacements: 5, isMvp: true, eloDelta: index === 2 ? null : 4,
  eloPlacement: index === 2, umaAssignments: [{ ordinal: 0, umaId: '100101' }, { ordinal: 1, umaId: '100102' }] });
const batchPlayer = (id, overrides = {}) => ({ discordId: id, displayName: `Batch ${id.slice(-1)}`, nickname: null,
  title: 'Fixture title', statsHidden: false, stats: stats(),
  history: { total: 8, summary: historySummary(), recent: [entry(0), entry(1, 'corrected', null),
    entry(2, 'reported', false), entry(3, 'pending'), entry(4), entry(5), entry(6)] }, ...overrides });

function harness({ batchStatus = 200, batchPlayers, latency = 1, fast = true, historyPages, leaderboardEntries = [] } = {}) {
  const calls = [], diagnostics = [], timerDelays = [];
  const c = vm.createContext({ console, URL, AbortController,
    setTimeout: (callback, ms) => { timerDelays.push(ms); return setTimeout(callback, ms); }, clearTimeout, Date,
    recordDiagnostic: value => diagnostics.push(value),
    fetch: async (url, options) => {
      calls.push(url.pathname + url.search);
      const status = url.pathname.endsWith('/batch') ? batchStatus : 200;
      return { ok: status < 400, status, headers: new Headers(), body: { cancel: async () => {} },
        json: async () => {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, latency);
            options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
          });
          if (url.pathname === '/api/seasons') return [{ id: 'S1', active: true }];
          if (url.pathname === '/api/leaderboard') return { entries: leaderboardEntries };
          if (url.pathname.endsWith('/batch')) return { mode: 'ranked', season: url.searchParams.get('season'),
            players: batchPlayers ?? url.searchParams.get('ids').split(',').map(id => batchPlayer(id)) };
          if (url.pathname.endsWith('/history')) return historyPages?.[Number(url.searchParams.get('page'))] ??
            { page: Number(url.searchParams.get('page')), pageSize: 20, total: 25, playerHistory: [entry(1)] };
          if (url.pathname.endsWith('/profile')) return { displayName: 'Legacy fixture' };
          return stats();
        } };
    }
  });
  for (const module of ['profileConstants', 'umaReleaseOrder', 'umaPortraits', 'requestQueue']) loadModule(c, module);
  loadModule(c, 'playerProfileApi', { fast });
  return { c, calls, diagnostics, timerDelays };
}

test('a complete roster starts batch loading without the settling timer', async () => {
  const h = harness({ fast: false });
  for (const name of ['fetchBatchPlayerProfileSummaries', 'waitForBatchBudget', 'waitForBatchSettle', 'mapBatchPlayer']) {
    assert.equal(typeof h.c[name], 'function', `${name} remains exported for the private build`);
  }
  await h.c.fetchBatchPlayerProfileSummaries(players(10), { scope: 'currentSeason', rosterComplete: true });
  assert.equal(h.calls.filter(path => path.includes('/batch?')).length, 1);
  assert(!h.timerDelays.includes(1200));
});

test('season leaderboard exposes cached ranked rows without an extra endpoint', async () => {
  const h = harness({ leaderboardEntries: [
    { userId: ids[0], displayName: 'Leader', rating: 1700, rd: 50, wins: 12, losses: 8 },
    { userId: ids[1], displayName: 'Runner', rating: 1600, rd: 60, wins: 10, losses: 10 }
  ] });
  const signal = new AbortController().signal;
  const first = await h.c.getSeasonLeaderboard(signal);
  const second = await h.c.getSeasonLeaderboard(signal);
  assert.equal(first.activeSeasonId, 'S1');
  assert.deepEqual(Array.from(first.entries, ({ rank, userId, displayName, rating, rd, wins, losses }) =>
    ({ rank, userId, displayName, rating, rd, wins, losses })), [
    { rank: 1, userId: ids[0], displayName: 'Leader', rating: 1700, rd: 50, wins: 12, losses: 8 },
    { rank: 2, userId: ids[1], displayName: 'Runner', rating: 1600, rd: 60, wins: 10, losses: 10 }
  ]);
  assert.equal(second.entries.length, 2);
  assert.equal(h.calls.filter(path => path === '/api/seasons').length, 1);
  assert.equal(h.calls.filter(path => path.startsWith('/api/leaderboard?')).length, 1);
});

test('every request diagnostic, including batch and history, retains its endpoint', async () => {
  const h = harness();
  await h.c.fetchBatchPlayerProfileSummaries(players(2), { scope: 'allTime', rosterComplete: true });
  await h.c.fetchPlayerHistoryPage(ids[0], 'allTime', 1);
  const sanitizer = vm.createContext({});
  loadModule(sanitizer, 'diagnosticRecorder');
  const requests = h.diagnostics.filter(value => value.kind === 'request');
  assert(requests.some(value => value.endpoint === 'batch'));
  assert(requests.some(value => value.endpoint === 'history'));
  assert(requests.every(value => typeof value.endpoint === 'string' &&
    sanitizer.sanitizeDiagnostic(value)?.endpoint === value.endpoint));
});

test('public cold ten-player lobby uses paced stats requests without profile, batch or history', async () => {
  const h = harness();
  const result = await h.c.fetchPlayerProfileSummaries(players(10), { scope: 'currentSeason' });
  assert.equal(h.calls.length, 12);
  assert.equal(h.calls.filter(path => path.includes('/stats?')).length, 10);
  assert.equal(h.calls.filter(path => path.endsWith('/profile')).length, 0);
  assert.equal(h.calls.filter(path => path.includes('/batch?') || path.includes('/history?')).length, 0);
  assert.equal(result[ids[0]].recentMatches.length, 0);
  assert.equal(result[ids[0]].historyTotal, undefined);
  assert.equal(result[ids[0]].matches, 4);
});

test('batch mapping keeps public core stats independent of history for private callers', async () => {
  const h = harness({ fast: false, latency: 10 });
  const result = await h.c.fetchBatchPlayerProfileSummaries(players(10), { scope: 'currentSeason', rosterComplete: true });
  assert.equal(h.calls.filter(path => path.includes('/batch?')).length, 1);
  assert.equal(h.calls.length, 3);
  assert(!h.calls.some(path => path.endsWith('/profile') || path.includes('/history?')));
  const profile = result[ids[0]];
  assert.equal(profile.matches, 4);
  assert.equal(profile.wins, 3);
  assert.equal(profile.losses, 1);
  assert.equal(profile.winRate, 0.75);
  assert.equal(profile.pointsPerGame, 3);
  assert.equal(profile.mvpMatches, 1);
  assert.equal(profile.allUmas[0].matches, 4);
  assert.equal(profile.allUmas[0].wins, 3);
  assert.equal(profile.historyTotal, 8);
  assert.equal(profile.historySummary.wins, 99);
  assert.equal(profile.recentMatches.length, 5);
  assert.equal(profile.recentMatches[1].isWinner, null);
  assert.equal(profile.recentMatches[1].result, 'unknown');
  assert.equal(profile.recentMatches[2].umaName, 'Disqualified');
  assert.equal(profile.recentMatches[2].umaAssignments.length, 2);
});

test('hidden, unknown, and malformed batch entries remain independent', async () => {
  const fixture = [
    batchPlayer(ids[0], { statsHidden: true, stats: null, history: null }),
    batchPlayer(ids[1], { displayName: ids[1], stats: { summary: { matchesIncluded: 0, totalPointsScored: 0, totalPodiumPlacements: 0, totalMvpMatches: 0 }, umaEntries: [] }, history: { total: 0, summary: historySummary(), recent: [] } }),
    batchPlayer(ids[2], { stats: { summary: null, umaEntries: [] } })
  ];
  const h = harness({ batchPlayers: fixture });
  const result = await h.c.fetchBatchPlayerProfileSummaries(players(3), { scope: 'allTime' });
  assert.equal(result[ids[0]].statsPrivate, true);
  assert.equal(result[ids[0]].title, 'Fixture title');
  assert.equal(result[ids[1]].displayName, 'Roster 1');
  assert.equal(result[ids[1]].matches, 0);
  assert.match(result[ids[2]].error, /Invalid player/);
  assert.equal(h.calls.filter(path => path.includes('/batch?')).length, 1);
  assert(!h.calls.some(path => path.endsWith('/profile')));
});

test('batch 404 falls back to the original selected-scope path and is remembered', async () => {
  const h = harness({ batchStatus: 404 });
  await h.c.fetchBatchPlayerProfileSummaries(players(10), { scope: 'currentSeason' });
  assert.equal(h.calls.filter(path => path.includes('/batch?')).length, 1);
  assert.equal(h.calls.filter(path => path.endsWith('/profile')).length, 0);
  assert.equal(h.calls.filter(path => path.includes('/stats?')).length, 10);
  assert.equal(h.calls.length, 13);
  await h.c.fetchBatchPlayerProfileSummaries(players(1), { scope: 'currentSeason' });
  assert.equal(h.calls.filter(path => path.includes('/batch?')).length, 1);
  const future = Date.now() + 10 * 60 * 1000 + 1;
  h.c.Date = class extends Date { static now() { return future; } };
  await h.c.fetchBatchPlayerProfileSummaries(players(1), { scope: 'currentSeason' });
  assert.equal(h.calls.filter(path => path.includes('/batch?')).length, 2);
});

test('batch 429 uses the API cooldown and does not run the fallback', async () => {
  const h = harness({ batchStatus: 429 });
  await assert.rejects(h.c.fetchBatchPlayerProfileSummaries(players(1), { scope: 'allTime' }), /HTTP 429/);
  assert.equal(h.c.getApiCooldown().status, 429);
  assert(!h.calls.some(path => path.endsWith('/profile') || path.includes('/stats?')));
});

test('batch 5xx also falls back without disabling future batch attempts', async () => {
  const h = harness({ batchStatus: 503 });
  await h.c.fetchBatchPlayerProfileSummaries(players(1), { scope: 'allTime' });
  assert(h.calls.some(path => path.includes('/stats?')));
  assert(!h.calls.some(path => path.endsWith('/profile')));
  await h.c.fetchBatchPlayerProfileSummaries(players(1), { scope: 'allTime' });
  assert.equal(h.calls.filter(path => path.includes('/batch?')).length, 2);
});

test('players arriving one at a time settle into one batch call', async () => {
  const h = harness();
  const requests = [];
  for (let count = 1; count <= 10; count += 1) {
    const controller = new AbortController();
    requests.push(controller);
    void h.c.fetchBatchPlayerProfileSummaries(players(count), { scope: 'currentSeason', signal: controller.signal })
      .catch(() => {});
    if (count < 10) {
      await new Promise(resolve => setTimeout(resolve, 2));
      controller.abort(new Error('Roster expanded'));
    }
  }
  await waitUntil(() => h.calls.filter(path => path.includes('/batch?')).length === 1);
  assert.equal(h.calls.filter(path => path.includes('/batch?')).length, 1);
});

test('rolling batch budget publishes a wait and resumes without per-player fallback', async () => {
  const h = harness();
  vm.runInContext('batchStartedAt.push(...Array(8).fill(Date.now() - 59970))', h.c);
  const waits = [];
  const started = performance.now();
  const result = await h.c.fetchBatchPlayerProfileSummaries(players(1), { scope: 'allTime', onWait: seconds => waits.push(seconds) });
  assert(waits.length >= 1 && waits[0] >= 1);
  assert(performance.now() - started >= 25);
  assert.equal(result[ids[0]].matches, 4);
  assert.equal(h.calls.filter(path => path.includes('/batch?')).length, 1);
  assert(!h.calls.some(path => path.endsWith('/profile')));
});

test('history pages are requested on demand, cached, and cancellable', async () => {
  const h = harness({ latency: 5 });
  const first = await h.c.fetchPlayerHistoryPage(ids[0], 'allTime', 1);
  const second = await h.c.fetchPlayerHistoryPage(ids[0], 'allTime', 2);
  await h.c.fetchPlayerHistoryPage(ids[0], 'allTime', 1);
  assert.equal(first.total, 25);
  assert.equal(second.page, 2);
  assert.equal(h.calls.filter(path => path.includes('/history?')).length, 2);
  const slow = harness({ latency: 100 });
  const controller = new AbortController();
  const pending = slow.c.fetchPlayerHistoryPage(ids[0], 'allTime', 1, controller.signal);
  setTimeout(() => controller.abort(new Error('Details closed')), 10);
  await assert.rejects(pending, /Details closed/);
});

test('opening details makes one profile request plus the first history page, cached and cancellable', async () => {
  const h = harness({ latency: 5 });
  const [profile, history] = await Promise.all([
    h.c.fetchPlayerProfileTitle(ids[0]),
    h.c.fetchPlayerHistoryPage(ids[0], 'allTime', 1)
  ]);
  assert.equal(profile.title, null);
  assert.equal(history.page, 1);
  assert.equal(h.calls.filter(path => path.endsWith('/profile')).length, 1);
  assert.equal(h.calls.filter(path => path.includes('/history?')).length, 1);
  await h.c.fetchPlayerProfileTitle(ids[0]);
  assert.equal(h.calls.filter(path => path.endsWith('/profile')).length, 1, 'the 24-hour profile cache avoids a second request');
  const slow = harness({ latency: 100 });
  const controller = new AbortController();
  const pending = slow.c.fetchPlayerProfileTitle(ids[0], controller.signal);
  setTimeout(() => controller.abort(new Error('Details closed')), 10);
  await assert.rejects(pending, /Details closed/);
});
