import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadFunction, parseTsxModule, readModule } from './support/harness.mjs';

const teamSectionSyntax = parseTsxModule('uiLobbyTeamSection');
const badgeChipSyntax = parseTsxModule('uiLobbyBadgeChip');
const playerDrawerSyntax = parseTsxModule('uiPlayerDrawer');
const playerDetailSyntax = parseTsxModule('uiPlayerDetailScene');
const badgesSyntax = parseTsxModule('uiCommonBadges');
const recentMatchesSyntax = parseTsxModule('uiPlayerRecentMatchesList');

function cardStateHarness() {
  const c = vm.createContext({
    hasDisplayableProfileLists: (profile) =>
      (profile?.topUmas?.length ?? 0) > 0 || (profile?.bestUmas?.length ?? 0) > 0 ||
      (profile?.allUmas?.length ?? 0) > 0 || (profile?.recentMatches?.length ?? 0) > 0,
    IS_PRIVATE_BUILD: false
  });
  loadFunction(c, teamSectionSyntax, 'getCardState');
  return c;
}

const emptyDisplay = { topUmas: [] };
const withUmas = { topUmas: [{ umaId: 'a', name: 'A' }] };

test('a card with no linked Discord ID never shows loading, private or error chrome', () => {
  const c = cardStateHarness();
  assert.equal(c.getCardState(undefined, undefined, true, undefined), 'loaded');
  assert.equal(c.getCardState({ discordId: 'x' }, emptyDisplay, true, undefined), 'loaded');
});

test('an unfetched profile shows the skeleton only while a fetch is in flight', () => {
  const c = cardStateHarness();
  assert.equal(c.getCardState(undefined, undefined, true, 'd1'), 'loading');
  assert.equal(c.getCardState(undefined, undefined, false, 'd1'), 'loaded');
});

test('private stats without a usable Uma list are private on the public build, estimated only on the private build with a derived history', () => {
  const c = cardStateHarness();
  const privateProfile = { discordId: 'd1', statsPrivate: true };
  assert.equal(c.getCardState(privateProfile, emptyDisplay, false, 'd1', false), 'private');
  assert.equal(c.getCardState(privateProfile, emptyDisplay, false, 'd1', true), 'private');
  assert.equal(c.getCardState({ ...privateProfile, historyDerived: true }, emptyDisplay, false, 'd1', true), 'estimated');
  assert.equal(c.getCardState({ ...privateProfile, historyDerived: true }, emptyDisplay, false, 'd1', false), 'private');
});

test('a stats-private profile that still carries a displayable Uma list is loaded, not private', () => {
  const c = cardStateHarness();
  assert.equal(c.getCardState({ discordId: 'd1', statsPrivate: true }, withUmas, false, 'd1'), 'loaded');
});

test('a failed fetch with nothing displayable is an error card; a failed fetch with cached data stays loaded', () => {
  const c = cardStateHarness();
  assert.equal(c.getCardState({ discordId: 'd1', error: 'HTTP 503' }, emptyDisplay, false, 'd1'), 'error');
  assert.equal(c.getCardState({ discordId: 'd1', error: 'HTTP 503' }, withUmas, false, 'd1'), 'loaded');
});

test('badge chip ordering puts rank first, then playstyle, then sample size, regardless of input order', () => {
  const c = vm.createContext({
    CARD_BADGE_PRIORITY: { top10: 0, top25: 1, mvpMenace: 2, eliteScoring: 3, highScoring: 3, consistent: 4, established: 5 }
  });
  loadFunction(c, badgeChipSyntax, 'sortBadgesForCard');
  const badges = [
    { kind: 'established', label: 'Established' },
    { kind: 'mvpMenace', label: 'MVP Menace' },
    { kind: 'top25', label: 'Top 25' },
    { kind: 'consistent', label: 'Consistent' }
  ];
  const ordered = Array.from(c.sortBadgesForCard(badges), (badge) => badge.kind);
  assert.deepEqual(ordered, ['top25', 'mvpMenace', 'consistent', 'established']);
  assert.notDeepEqual(ordered, Array.from(badges, (badge) => badge.kind), 'input array order is unchanged');
});

test('the match history pager always resolves to at most 7 slots, with the current page centered once truncated', () => {
  const c = vm.createContext({ PAGER_SLOT_COUNT: 7 });
  loadFunction(c, playerDrawerSyntax, 'getPagerSlots');
  const slots = (page, totalPages) => Array.from(c.getPagerSlots(page, totalPages));
  assert.deepEqual(slots(1, 3), [1, 2, 3]);
  assert.deepEqual(slots(1, 10), [1, 2, 3, 4, 5, 'gap', 10]);
  assert.deepEqual(slots(10, 10), [1, 'gap', 6, 7, 8, 9, 10]);
  assert.deepEqual(slots(7, 12), [1, 'gap', 6, 7, 8, 'gap', 12]);
  for (const totalPages of [1, 5, 7, 8, 15, 40]) {
    for (let page = 1; page <= totalPages; page += 1) {
      assert(slots(page, totalPages).length <= 7, `page ${page} of ${totalPages} stays within 7 slots`);
    }
  }
});

test('the card badge area is a fixed two-row height so cards never shift as badges resolve', () => {
  const css = readModule('uiLobbyCss');
  assert.match(css, /\.card-badges\s*\{[^}]*height:\s*49px/s);
  assert.match(css, /\.chip:hover \.chip-tooltip,\s*\n?\s*\.chip:focus-visible \.chip-tooltip/);
});

test('the card badge area keeps overflow visible so chip tooltips are not clipped, and a hovered/focused card raises z-index to stack over neighbours', () => {
  const lobbyCss = readModule('uiLobbyCss');
  assert.match(lobbyCss, /\.card-badges\s*\{[^}]*height:\s*49px[^}]*\}/s, 'the badge area keeps its fixed height');
  assert.match(lobbyCss, /\.card-badges\s*\{[^}]*overflow:\s*visible/s, 'overflow must not clip the chip tooltip');
  assert.doesNotMatch(lobbyCss, /\.card-badges\s*\{[^}]*overflow:\s*hidden/s);

  const baseCss = readModule('uiCommonBaseCss');
  assert.match(
    baseCss,
    /\.player-row:hover,\s*\n?\s*\.player-row:focus-within\s*\{[^}]*z-index:/s,
    'a hovered or focused card must raise its stacking order above sibling cards'
  );
});

test('card content sits above .card-hit for stacking only, not for clicks: it is pointer-events:none except for chips and the Retry button, so the whole card opens the drawer', () => {
  const css = readModule('uiLobbyCss');
  assert.match(
    css,
    /\.player-row > \*:not\(\.card-hit\)\s*\{[^}]*pointer-events:\s*none/s,
    'card content must not swallow clicks meant for .card-hit'
  );
  assert.match(
    css,
    /\.chip,\s*\n?\s*\.card-message-box button\s*\{[^}]*pointer-events:\s*auto/s,
    'chips and the Retry button must opt back into pointer events for their own hover/click behavior'
  );
});

test('the details drawer is a fixed 600px overlay, not a page it never scrolls as a whole', () => {
  const css = readModule('uiPlayerDrawerCss');
  assert.match(css, /\.player-drawer\s*\{[^}]*width:\s*min\(var\(--drawer-width\), 100vw\)/s);
  assert.match(css, /\.player-drawer\s*\{[^}]*overflow:\s*hidden/s);
});

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

function drawerHarness() {
  const c = vm.createContext({
    console,
    element: (type, props, ...children) => ({ type, props, children }),
    React: { Fragment: 'Fragment' },
    UmaImage: 'Image', BestUmaPortrait: 'Portrait', StatCell: 'Stat', ProfileDataStatus: 'Status',
    getFallbackUmaImageUrl: () => undefined,
    getPlayerPartyVisual: () => undefined, getTeamPartyVisuals: () => ({}),
    getLookupDiscordId: (p) => p.discordId, getPlayerNote: () => undefined,
    getDisplayedProfileStats: (profile) => profile,
    formatRank: () => '#1', formatRecord: () => '-', formatPercent: () => '-', formatDecimal: () => '-', formatNumber: () => '-',
    HISTORY_PAGE_SIZE: 5, UMA_TABLE_ROWS: 5, PAGER_SLOT_COUNT: 7,
    UMA_SORT_COLUMNS: [
      { key: 'matches', label: 'GP' }, { key: 'winRate', label: 'Win' },
      { key: 'pointsPerGame', label: 'PPG' }, { key: 'performanceScore', label: 'Score' }
    ]
  });
  loadFunction(c, badgesSyntax, 'hasDisplayableProfileLists');
  loadFunction(c, badgesSyntax, 'getNotableBadges');
  loadFunction(c, playerDetailSyntax, 'withDetailHistory');
  loadFunction(c, recentMatchesSyntax, 'getRecentResultTone');
  loadFunction(c, recentMatchesSyntax, 'formatRecentResult');
  loadFunction(c, playerDrawerSyntax, 'umaSortValue');
  loadFunction(c, playerDrawerSyntax, 'formatUmaColumnValue');
  loadFunction(c, playerDrawerSyntax, 'getPagerSlots');
  loadFunction(c, playerDrawerSyntax, 'PlayerDrawer');
  return c;
}

function confirmedMatch(id, isWinner, pointsScored = 4) {
  return {
    matchId: id, reportedAt: '2026-01-01T00:00:00Z', mode: 'ranked', verificationState: 'confirmed',
    umaId: 'u1', umaName: 'Uma', isWinner, pointsScored, podiums: isWinner ? 1 : 0, isMvp: false
  };
}

function renderableDrawer(profile) {
  const c = drawerHarness();
  let states = [], refs = [], effects = [], stateIdx = 0, refIdx = 0, effectIdx = 0, nextId = 0;
  c.crypto = { randomUUID: () => `req-${++nextId}` };
  c.useState = (initial) => {
    const i = stateIdx++;
    if (states[i] === undefined) states[i] = [initial, (update) => { states[i][0] = typeof update === 'function' ? update(states[i][0]) : update; }];
    return states[i];
  };
  c.useRef = (initial) => {
    const i = refIdx++;
    if (refs[i] === undefined) refs[i] = { current: initial };
    return refs[i];
  };
  c.useEffect = (callback) => { effects[effectIdx++] = callback; };
  c.cancelPlayerHistoryPageRequest = async () => {};
  c.sendPlayerProfileRequest = () => new Promise(() => {});
  c.cancelPlayerProfileRequest = async () => {};
  const render = () => {
    stateIdx = 0; refIdx = 0; effectIdx = 0;
    return c.PlayerDrawer({
      player: { discordId: '123456789012345678', displayName: 'Fixture' },
      profile,
      onClose() {},
      context: { statsScope: 'allTime', isProfileLoading: false, now: Date.now() }
    });
  };
  return { c, render, effects: () => effects };
}

test('history page one enriches badges with the real recentForm, so Consistent can appear in the drawer, matching PlayerDetailScene', async () => {
  const profile = {
    discordId: '123456789012345678', displayName: 'Fixture', fetchedAt: Date.now(), profileUrl: '',
    matches: 30, wins: 15, losses: 15, winRate: 0.5, pointsPerGame: 4, mvpMatches: 2, rank: 400,
    // A stale cached recentForm that would already qualify for Consistent, to prove it is stripped pre-load.
    recentForm: { matches: 10, scoredMatches: 9, scoringRate: 0.9, wins: 6, winRate: 0.6, points: 40, pointsPerGame: 4, podiums: 4, mvpMatches: 1 }
  };
  const { c, render, effects } = renderableDrawer(profile);
  const historyMatches = Array.from({ length: 5 }, (_, i) => confirmedMatch(`H${i}`, true, 4));
  c.sendPlayerHistoryPageRequest = (id, scope, page) =>
    page === 1
      ? Promise.resolve({
          total: 25, matches: historyMatches,
          summary: { wins: 5, losses: 0, pointsScored: 20, podiumPlacements: 5, firstPlaceFinishes: 5, secondPlaceFinishes: 0, thirdPlaceFinishes: 0, mvpAwards: 0 }
        })
      : new Promise(() => {});

  const before = render();
  const badgesBefore = findAll(before, (n) => n.props?.className?.includes?.('notable-tag')).map((n) => n.children[0]);
  assert(!badgesBefore.includes('Consistent'), 'a stale cached recentForm must not produce Consistent before page one has loaded');

  effects()[0]();
  await new Promise((resolve) => setImmediate(resolve));

  const after = render();
  const badgesAfter = findAll(after, (n) => n.props?.className?.includes?.('notable-tag')).map((n) => n.children[0]);
  assert(badgesAfter.includes('Consistent'), 'Consistent should appear once page-1 history resolves with a high scoring rate, same as the old detail scene');
});

test('the last-5 dots beside Match history show real confirmed results once loaded, and neutral placeholders before that', async () => {
  const profile = {
    discordId: '123456789012345678', displayName: 'Fixture', fetchedAt: Date.now(), profileUrl: '',
    matches: 12, wins: 7, losses: 5, winRate: 0.58, pointsPerGame: 4, mvpMatches: 1
  };
  const { c, render, effects } = renderableDrawer(profile);
  const historyMatches = [
    confirmedMatch('H0', true), confirmedMatch('H1', true), confirmedMatch('H2', true),
    confirmedMatch('H3', false), confirmedMatch('H4', false)
  ];
  c.sendPlayerHistoryPageRequest = (id, scope, page) =>
    page === 1 ? Promise.resolve({ total: 12, matches: historyMatches, summary: undefined }) : new Promise(() => {});

  const before = render();
  const dotsBefore = findAll(before, (n) => typeof n.props?.className === 'string' && n.props.className.startsWith('dot'));
  assert.equal(dotsBefore.length, 5, 'exactly 5 dots render while history has not loaded yet');
  assert(dotsBefore.every((n) => n.props.className === 'dot dot-u'), 'placeholder dots are neutral before history loads');

  effects()[0]();
  await new Promise((resolve) => setImmediate(resolve));

  const after = render();
  const dotsAfter = findAll(after, (n) => typeof n.props?.className === 'string' && n.props.className.startsWith('dot'));
  assert.deepEqual(
    Array.from(dotsAfter, (n) => n.props.className),
    ['dot dot-w', 'dot dot-w', 'dot dot-w', 'dot dot-l', 'dot dot-l']
  );
});
