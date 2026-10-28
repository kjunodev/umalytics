import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, context, deferred, tick, roster } from './support/helpers.mjs';

// Runs the real background entrypoint (defineBackground's main) against fake
// browser APIs. A new harness is a fresh MV3 service worker: module memory is
// empty, while `session` (storage.session) and `local` can be carried over.
function lifecycleHarness({ session = {}, local = {}, tabsQuery, failLocalKeys = [], scan } = {}) {
  let main;
  const listeners = {};
  const event = name => ({ addListener: fn => { (listeners[name] ??= []).push(fn); }, removeListener() {} });
  const area = (store, failing = []) => ({
    get: async key => {
      if (failing.includes(key)) throw new Error(`storage unavailable: ${key}`);
      return key in store ? { [key]: store[key] } : {};
    },
    set: async values => { Object.assign(store, structuredClone(values)); },
    remove: async key => { delete store[key]; }
  });
  const activeTab = { id: 1, active: true, url: 'https://drafter.uma.guide/spectate/ROOM01' };
  const state = { latest: roster('ROOM01'), draft: { matchCode: 'ROOM01' }, rosterWrites: [], draftClears: 0 };
  const c = context({
    defineBackground: fn => { main = fn; },
    registerExplorerService: () => {},
    isUmaLyticsMessage: () => true,
    getDiagnosticTrace: async () => ['trace'],
    getApiCooldown: () => undefined, restoreApiCooldown: () => {}, queueTeamIconRefresh: () => Promise.resolve(),
    extractMatchCodeFromUrl: url => url.split('/').at(-1),
    browser: {
      storage: { local: area(local, failLocalKeys), session: area(session), onChanged: event('storage') },
      tabs: {
        query: tabsQuery ?? (async () => [activeTab]),
        get: async id => ({ ...activeTab, id, active: id === 1 }),
        onActivated: event('tabActivated'), onUpdated: event('tabUpdated')
      },
      alarms: { clear: async () => {}, create: async () => {}, onAlarm: event('alarm') },
      action: { onClicked: event('action') },
      windows: { onRemoved: event('windowRemoved'), onBoundsChanged: event('bounds'), create: async () => ({ id: 9 }), update: async () => {} },
      runtime: { getURL: p => p, onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message'), onConnect: event('connect') },
      scripting: { executeScript: async () => {} }
    },
    getLobbyLockState: async () => undefined,
    getLatestPrematchRoster: async () => state.latest,
    setLatestPrematchRoster: async value => { state.latest = value; state.rosterWrites.push(value); },
    clearLatestPrematchRoster: async () => { state.latest = undefined; },
    getLatestDraftSnapshot: async () => state.draft,
    setLatestDraftSnapshot: async value => { state.draft = value; },
    clearLatestDraftSnapshot: async () => { state.draft = undefined; state.draftClears += 1; },
    getPlayerProfileSummaries: async () => undefined, getCachedPlayerProfiles: async () => ({}),
    rememberCachedPlayerProfiles: async () => {}, setPlayerProfileSummaries: async () => {},
    fetchPlayerProfileSummaries: () => new Promise(() => {}),
    sendRoomDomScanRequest: async (tabId, options) => (scan ? scan(tabId, options) : { activeLobby: true, matchCode: 'ROOM01' })
  });
  evaluate(c, 'profileConstants'); evaluate(c, 'rosterDisplay'); evaluate(c, 'profileCache'); evaluate(c, 'background');
  main();
  const send = (message, tabId) => listeners.message[0](message, tabId === undefined ? {} : { tab: { id: tabId } });
  return { c, state, session, local, send, listeners };
}

test('after a worker restart, a background drafter tab cannot replace the selected room before the tab is re-selected', async () => {
  const session = {};
  const before = lifecycleHarness({ session });
  await before.c.handleLobbyReconnectRequested();
  assert.equal(session.selectedDrafterTabId, 1, 'the selected drafter tab survives in storage.session');

  // Restart while the startup reconnect is still waiting on the browser.
  const pendingQuery = deferred();
  const after = lifecycleHarness({ session, tabsQuery: () => pendingQuery.promise });
  await after.send({ type: 'prematch-roster-detected', roster: roster('OTHER1') }, 2);
  await after.send({ type: 'draft-snapshot-detected', snapshot: { matchCode: 'OTHER1' } }, 2);
  assert.equal(after.state.rosterWrites.length, 0, 'a background tab cannot overwrite the active roster');
  assert.equal(after.state.draft.matchCode, 'ROOM01', 'or its draft');
  await after.send({ type: 'prematch-roster-detected', roster: roster('ROOM01') }, 1);
  assert.equal(after.state.rosterWrites.length, 1, 'the selected tab is still accepted');
  pendingQuery.resolve([]);
});

test('with no remembered tab, roster messages wait for the startup reconnect to choose the drafter tab', async () => {
  const sent = [];
  let h;
  // The content script answers the startup scan by publishing its roster and
  // waiting for the acknowledgement; this must not deadlock.
  h = lifecycleHarness({ scan: async tabId => { sent.push(await h.send({ type: 'prematch-roster-detected', roster: roster('ROOM01') }, tabId)); return { activeLobby: true, matchCode: 'ROOM01' }; } });
  const fromBackgroundTab = h.send({ type: 'prematch-roster-detected', roster: roster('OTHER1') }, 2);
  await fromBackgroundTab;
  await h.c.handleLobbyReconnectRequested();
  assert.equal(sent.length, 1, 'the startup scan completed');
  assert.deepEqual(h.state.rosterWrites.map(value => value.matchCode), ['ROOM01'], 'only the selected tab wrote a roster');
  assert.equal(h.state.draftClears, 0, 'the active draft was not cleared by another room');
});

test('a storage failure during startup does not break every later message', async () => {
  const h = lifecycleHarness({ failLocalKeys: ['profileRecovery', 'profileManualRefreshAt'] });
  const trace = await h.send({ type: 'diagnostic-trace-requested' });
  assert.deepEqual(Array.from(trace), ['trace']);
  await h.send({ type: 'prematch-roster-detected', roster: roster('ROOM01') }, 1);
  assert.equal(h.state.rosterWrites.length, 1);
  await tick();
});
