import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadFunction, loadModule, parseTsxModule, readModule } from './support/harness.mjs';

const teamSectionSyntax = parseTsxModule('uiLobbyTeamSection');
const playerDrawerSyntax = parseTsxModule('uiPlayerDrawer');
const playerDetailSyntax = parseTsxModule('uiPlayerProfileDisplay');
const recentMatchesSyntax = parseTsxModule('uiPlayerRecentMatchFormat');
const playersViewSyntax = parseTsxModule('uiPlayersView');

function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of (node.children ?? []).flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
}

function findAll(node, predicate, results = []) {
  if (!node || typeof node !== 'object') return results;
  if (predicate(node)) results.push(node);
  for (const child of (node.children ?? []).flat(Infinity)) findAll(child, predicate, results);
  return results;
}

const ICON = { teamId: 'team-rose', teamName: 'Rose Tempest', logoUrl: 'https://drafter.uma.guide/esports/teams/rose.png' };

// --- Pure map-building logic (profiles/esportsTeamApi.ts) ---

function apiContext() {
  return vm.createContext({ AbortController, URL });
}

test('collectLeagueTeamIds dedupes ids across standings and both sides of every entry', () => {
  const c = apiContext();
  loadModule(c, 'esportsTeamApi');
  const league = {
    standings: [{ teamId: 'a' }, { teamId: 'b' }, {}],
    entries: [{ teamA: { teamId: 'a' }, teamB: { teamId: 'c' } }, { teamA: { teamId: 'd' } }, {}]
  };
  // Array.from re-materializes the vm-realm array's values into this
  // realm's Array, so deepEqual isn't comparing across separate prototypes.
  assert.deepEqual(Array.from(c.collectLeagueTeamIds(league)).sort(), ['a', 'b', 'c', 'd']);
});

test('buildTeamIconMap excludes archived teams and resolves logoUrl against the portrait host', () => {
  const c = apiContext();
  loadModule(c, 'esportsTeamApi');
  const teams = [
    { id: 't1', name: 'Team One', logoUrl: '/esports/teams/one.png', archivedAt: null, roster: [{ discordId: 'd1' }, { discordId: 'd2' }] },
    { id: 't2', name: 'Team Two', logoUrl: '/esports/teams/two.png', archivedAt: '2026-01-01T00:00:00Z', roster: [{ discordId: 'd3' }] }
  ];
  const map = structuredClone(c.buildTeamIconMap(teams));
  assert.deepEqual(Object.keys(map).sort(), ['d1', 'd2'], 'the archived team contributes no entries');
  assert.deepEqual(map.d1, { teamId: 't1', teamName: 'Team One', logoUrl: 'https://drafter.uma.guide/esports/teams/one.png' });
  assert.equal(map.d3, undefined);
});

test('buildTeamIconMap gives a player with no active-season team no map entry', () => {
  const c = apiContext();
  loadModule(c, 'esportsTeamApi');
  const map = c.buildTeamIconMap([undefined, { id: 't1', name: 'Empty Roster', logoUrl: '/x.png', archivedAt: null, roster: [] }]);
  assert.deepEqual(Object.keys(map), []);
});

test('fetchTeamIconMap fetches teams one at a time at background priority with stable diagnostic labels', async () => {
  const calls = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const c = vm.createContext({
    AbortController, URL,
    fetchJson: async (path, signal, priority, label) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      calls.push({ path, priority, label });
      await new Promise(resolve => setTimeout(resolve, 1));
      concurrent -= 1;
      if (path === '/api/esports/league') return { standings: [{ teamId: 't1' }, { teamId: 't2' }], entries: [] };
      const teamId = path.split('/').pop();
      return { team: { id: teamId, name: `Team ${teamId}`, logoUrl: `/logo-${teamId}.png`, archivedAt: null, roster: [] } };
    }
  });
  loadModule(c, 'esportsTeamApi');
  const controller = new AbortController();
  const map = await c.fetchTeamIconMap(controller.signal);
  assert.equal(maxConcurrent, 1, 'team detail requests never overlap');
  assert.deepEqual(calls.map(call => call.priority), ['background', 'background', 'background']);
  assert.deepEqual(calls.map(call => call.label), ['esports-league', 'esports-team', 'esports-team']);
  assert.deepEqual(Object.keys(map), []); // both teams have empty rosters in this fixture
});

test('fetchTeamIconMap skips a team whose request fails and still builds a partial map from the rest', async () => {
  const c = vm.createContext({
    AbortController, URL,
    fetchJson: async path => {
      if (path === '/api/esports/league') return { standings: [{ teamId: 't1' }, { teamId: 't2' }, { teamId: 't3' }], entries: [] };
      if (path.endsWith('/t2')) throw new Error('team detail 500');
      const teamId = path.split('/').pop();
      return { team: { id: teamId, name: `Team ${teamId}`, logoUrl: `/logo-${teamId}.png`, archivedAt: null, roster: [{ discordId: `d-${teamId}` }] } };
    }
  });
  loadModule(c, 'esportsTeamApi');
  const map = structuredClone(await c.fetchTeamIconMap(new AbortController().signal));
  assert.deepEqual(Object.keys(map).sort(), ['d-t1', 'd-t3'], 'the failing team (t2) contributes nothing, but t1 and t3 still do');
});

test('fetchTeamIconMap aborts the whole refresh when the league request itself fails', async () => {
  const c = vm.createContext({
    AbortController, URL,
    fetchJson: async path => { if (path === '/api/esports/league') throw new Error('league 500'); throw new Error('unreachable'); }
  });
  loadModule(c, 'esportsTeamApi');
  await assert.rejects(() => c.fetchTeamIconMap(new AbortController().signal), /league 500/);
});

// --- 24h cache TTL (storage/teamIconStorage.ts) ---

test('isTeamIconSnapshotFresh is true within 24h, false at and after the boundary, and false when missing', () => {
  const c = vm.createContext({});
  loadModule(c, 'teamIconStorage');
  const snapshot = { map: {}, fetchedAt: 1_000 };
  const dayMs = 24 * 60 * 60 * 1000;
  assert.equal(c.isTeamIconSnapshotFresh(undefined, 2_000), false);
  assert.equal(c.isTeamIconSnapshotFresh(snapshot, 1_000 + dayMs - 1), true);
  assert.equal(c.isTeamIconSnapshotFresh(snapshot, 1_000 + dayMs), false);
});

test('getTeamIconSnapshot/setTeamIconSnapshot round-trip through browser.storage.local', async () => {
  const stored = {};
  const c = vm.createContext({
    browser: { storage: { local: {
      get: async key => ({ [key]: stored[key] }),
      set: async values => Object.assign(stored, structuredClone(values))
    } } }
  });
  loadModule(c, 'teamIconStorage');
  assert.equal(await c.getTeamIconSnapshot(), undefined);
  await c.setTeamIconSnapshot({ map: { d1: ICON }, fetchedAt: 5_000 });
  assert.deepEqual(await c.getTeamIconSnapshot(), { map: { d1: ICON }, fetchedAt: 5_000 });
});

// --- Refresh orchestration (background/teamIcons.ts) ---

function teamIconRefreshContext({ snapshot, fetchImpl }) {
  const state = { snapshot, sets: [] };
  const c = vm.createContext({ AbortController });
  loadModule(c, 'teamIconStorage');
  c.getTeamIconSnapshot = async () => state.snapshot;
  c.setTeamIconSnapshot = async next => { state.sets.push(next); state.snapshot = next; };
  c.fetchTeamIconMap = fetchImpl;
  loadModule(c, 'teamIcons');
  return { c, state };
}

test('queueTeamIconRefresh never refetches while the cache is still fresh', async () => {
  let calls = 0;
  const { c, state } = teamIconRefreshContext({
    snapshot: { map: { old: true }, fetchedAt: Date.now() },
    fetchImpl: async () => { calls += 1; return {}; }
  });
  await c.queueTeamIconRefresh();
  assert.equal(calls, 0);
  assert.equal(state.sets.length, 0);
});

test('queueTeamIconRefresh refetches once the cache is older than 24h', async () => {
  let calls = 0;
  const stale = { map: { old: true }, fetchedAt: Date.now() - 25 * 60 * 60 * 1000 };
  const { c, state } = teamIconRefreshContext({ snapshot: stale, fetchImpl: async () => { calls += 1; return { fresh: true }; } });
  await c.queueTeamIconRefresh();
  assert.equal(calls, 1);
  assert.deepEqual(state.sets[0].map, { fresh: true });
});

test('queueTeamIconRefresh keeps the old cache and never throws when the fetch fails', async () => {
  const stale = { map: { old: true }, fetchedAt: 0 };
  const { c, state } = teamIconRefreshContext({ snapshot: stale, fetchImpl: async () => { throw new Error('network down'); } });
  await assert.doesNotReject(() => c.queueTeamIconRefresh());
  assert.equal(state.sets.length, 0, 'a failed refresh never overwrites the cache');
  assert.deepEqual(state.snapshot, stale);
});

// --- No periodic alarm; refreshes are only requested from real events ---

test('background.ts registers no periodic team-icon alarm and never forces a refresh past the cache', () => {
  const source = readModule('background');
  assert.doesNotMatch(source, /periodInMinutes/, 'no periodic browser.alarms schedule should exist for team icons');
  assert.doesNotMatch(source, /umalytics-team-icons/i, 'no dedicated team-icon alarm name should exist');
  const calls = source.match(/queueTeamIconRefresh\([^)]*\)/g) ?? [];
  assert.ok(calls.length >= 3, 'expected calls on startup, the scout window opening, and roster enrichment');
  for (const call of calls) assert.equal(call, 'queueTeamIconRefresh()', `${call} must not pass any force flag`);
});

test('background.ts requests a refresh when a roster is detected (start of enrichment) and when the scout window opens', () => {
  const source = readModule('background');
  const enrichBody = source.slice(source.indexOf('function enrichRosterProfiles('), source.indexOf('function enrichRosterProfiles(') + 400);
  assert.match(enrichBody, /queueTeamIconRefresh\(\)/, 'enrichRosterProfiles must request a (cache-respecting) refresh');
  const clickBody = source.slice(source.indexOf('browser.action?.onClicked.addListener'), source.indexOf('browser.action?.onClicked.addListener') + 300);
  assert.match(clickBody, /queueTeamIconRefresh\(\)/, 'opening the scout window must request a (cache-respecting) refresh');
});

// --- Rendering: the logo shows only for a mapped player ---

function playerRowHarness() {
  const c = vm.createContext({
    element: (type, props, ...children) => ({ type, props, children }),
    React: { Fragment: 'Fragment' },
    getCardProfile: profile => profile,
    getPlayerDisplayRating: () => 1500,
    getLookupDiscordId: p => p.discordId,
    getPlayerNote: () => undefined,
    getStatsMessage: () => undefined,
    getNotableBadges: () => [],
    getCardState: () => 'loaded',
    getPlayerRowClassName: () => 'player-row',
    CaptainCrown: 'CaptainCrown',
    TeamIcon: 'TeamIcon',
    CardBody: 'CardBody',
    formatRank: () => '#1'
  });
  loadFunction(c, teamSectionSyntax, 'PlayerRow');
  return c;
}

test('the lobby card renders the team icon after the name and captain crown, before the party chip', () => {
  const c = playerRowHarness();
  const player = { discordId: 'd1', displayName: 'Alice', isCaptain: true };
  const tree = c.PlayerRow({ player, isProfileLoading: false, statsScope: 'currentSeason', teamIcon: ICON, onShowDetails: () => {} });
  const nameRow = find(tree, n => n.props?.className === 'card-name-row');
  const iconNode = find(nameRow, n => n.type === 'TeamIcon');
  assert.equal(iconNode.props.icon, ICON);
  const flat = nameRow.children.flat(Infinity).filter(Boolean);
  const crownIndex = flat.findIndex(n => n?.type === 'CaptainCrown');
  const iconIndex = flat.findIndex(n => n?.type === 'TeamIcon');
  const spacerIndex = flat.findIndex(n => n?.props?.className === 'card-name-spacer');
  assert.ok(crownIndex >= 0 && crownIndex < iconIndex, 'the icon comes after the captain crown');
  assert.ok(iconIndex < spacerIndex, 'the icon comes before the party-chip spacer');
});

test('the lobby card renders no team icon for a player with no mapped team', () => {
  const c = playerRowHarness();
  const player = { discordId: 'd1', displayName: 'Alice' };
  const tree = c.PlayerRow({ player, isProfileLoading: false, statsScope: 'currentSeason', onShowDetails: () => {} });
  const nameRow = find(tree, n => n.props?.className === 'card-name-row');
  assert.equal(findAll(nameRow, n => n.type === 'TeamIcon').length, 0);
});

function drawerHarness() {
  const c = vm.createContext({
    console,
    element: (type, props, ...children) => ({ type, props, children }),
    React: { Fragment: 'Fragment' },
    UmaImage: 'Image', BestUmaPortrait: 'Portrait', StatCell: 'Stat', ProfileDataStatus: 'Status', TeamIcon: 'TeamIcon',
    getFallbackUmaImageUrl: () => undefined,
    getPlayerPartyVisual: () => undefined, getTeamPartyVisuals: () => ({}),
    getLookupDiscordId: p => p.discordId, getPlayerNote: () => undefined,
    getDisplayedProfileStats: profile => profile,
    getNotableBadges: () => [],
    formatRank: () => '#1', formatRecord: () => '-', formatPercent: () => '-', formatDecimal: () => '-', formatNumber: () => '-',
    HISTORY_PAGE_SIZE: 5, HISTORY_API_PAGE_SIZE: 20, UMA_TABLE_ROWS: 5, PAGER_SLOT_COUNT: 7, MIN_UMA_GAMES: 3,
    UMA_SORT_COLUMNS: [
      { key: 'matches', label: 'GP' }, { key: 'winRate', label: 'Win' },
      { key: 'pointsPerGame', label: 'PPG' }, { key: 'performanceScore', label: 'Score' }
    ]
  });
  loadFunction(c, playerDetailSyntax, 'withDetailHistory');
  loadFunction(c, recentMatchesSyntax, 'getRecentResultTone');
  loadFunction(c, recentMatchesSyntax, 'formatRecentResult');
  loadFunction(c, playerDrawerSyntax, 'umaSortValue');
  loadFunction(c, playerDrawerSyntax, 'formatUmaColumnValue');
  loadFunction(c, playerDrawerSyntax, 'getPagerSlots');
  loadFunction(c, playerDrawerSyntax, 'apiPageForPagerPage');
  loadFunction(c, playerDrawerSyntax, 'apiPageRowOffset');
  loadFunction(c, playerDrawerSyntax, 'PlayerDrawer');
  return c;
}

function renderableDrawer(context) {
  const c = drawerHarness();
  let states = [], refs = [], stateIdx = 0, refIdx = 0;
  c.crypto = { randomUUID: () => 'req-1' };
  c.useState = initial => {
    const i = stateIdx++;
    if (states[i] === undefined) states[i] = [initial, update => { states[i][0] = typeof update === 'function' ? update(states[i][0]) : update; }];
    return states[i];
  };
  c.useRef = initial => {
    const i = refIdx++;
    if (refs[i] === undefined) refs[i] = { current: initial };
    return refs[i];
  };
  c.useEffect = () => {};
  c.cancelPlayerHistoryPageRequest = async () => {};
  c.sendPlayerHistoryPageRequest = () => new Promise(() => {});
  c.sendPlayerProfileRequest = () => new Promise(() => {});
  c.cancelPlayerProfileRequest = async () => {};
  return () => {
    stateIdx = 0; refIdx = 0;
    return c.PlayerDrawer({
      player: { discordId: 'd1', displayName: 'Alice' },
      profile: undefined,
      onClose() {},
      context
    });
  };
}

test('the player drawer renders the team icon and team name beside the title only for a mapped player', () => {
  const mappedRender = renderableDrawer({ statsScope: 'currentSeason', isProfileLoading: false, now: Date.now(), teamIcon: ICON });
  const mapped = mappedRender();
  const titleRow = find(mapped, n => n.props?.className === 'player-drawer-title-row');
  const iconNode = find(titleRow, n => n.type === 'TeamIcon');
  assert.equal(iconNode.props.icon, ICON);
  assert.ok(find(titleRow, n => n.props?.className === 'player-drawer-team-name' && n.children[0] === ICON.teamName));

  const unmappedRender = renderableDrawer({ statsScope: 'currentSeason', isProfileLoading: false, now: Date.now() });
  const unmapped = unmappedRender();
  const unmappedTitleRow = find(unmapped, n => n.props?.className === 'player-drawer-title-row');
  assert.equal(findAll(unmappedTitleRow, n => n.type === 'TeamIcon').length, 0);
  assert.equal(find(unmappedTitleRow, n => n.props?.className === 'player-drawer-team-name'), undefined);
});

function leaderboardRowHarness() {
  const c = vm.createContext({
    element: (type, props, ...children) => ({ type, props, children }),
    React: { Fragment: 'Fragment' },
    TeamIcon: 'TeamIcon',
    rankTintClass: () => undefined,
    formatNumber: () => '-',
    formatLeaderboardRecord: () => '-',
    formatLeaderboardWinRate: () => '-',
    formatLeaderboardGames: () => '-'
  });
  loadFunction(c, playersViewSyntax, 'LeaderboardRow');
  return c;
}

test('the Players leaderboard row renders the team icon before the name only for a mapped player', () => {
  const c = leaderboardRowHarness();
  const entry = { rank: 1, userId: 'd1', displayName: 'Alice' };
  const mapped = c.LeaderboardRow({ entry, teamIcon: ICON, selected: false, onOpen: () => {} });
  const nameCell = find(mapped, n => n.props?.className === 'players-name');
  const flat = nameCell.children.flat(Infinity).filter(Boolean);
  const iconIndex = flat.findIndex(n => n?.type === 'TeamIcon');
  const textIndex = flat.findIndex(n => n?.props?.className === 'players-name-text');
  assert.ok(iconIndex >= 0 && iconIndex < textIndex, 'the icon comes before the name text');
  assert.equal(flat[iconIndex].props.icon, ICON);

  const unmapped = c.LeaderboardRow({ entry, selected: false, onOpen: () => {} });
  const unmappedNameCell = find(unmapped, n => n.props?.className === 'players-name');
  assert.equal(findAll(unmappedNameCell, n => n.type === 'TeamIcon').length, 0);
});
