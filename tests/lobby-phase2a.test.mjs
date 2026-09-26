import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadFunction, parseTsxModule, readModule } from './support/harness.mjs';

const teamSectionSyntax = parseTsxModule('uiLobbyTeamSection');
const badgeChipSyntax = parseTsxModule('uiLobbyBadgeChip');
const playerDrawerSyntax = parseTsxModule('uiPlayerDrawer');
const playerDetailSyntax = parseTsxModule('uiPlayerProfileDisplay');
const badgesSyntax = parseTsxModule('uiCommonBadges');
const recentMatchesSyntax = parseTsxModule('uiPlayerRecentMatchFormat');
const topUmasListSyntax = parseTsxModule('uiPlayerTopUmasList');

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

test('an unfetched card prints the profile status once in its message area', () => {
  const c = vm.createContext({
    element: (type, props, ...children) => ({ type, props, children }),
    React: { Fragment: 'Fragment' }, BadgeChipRow: 'Badges', StatCell: 'Stat',
    TopUmasList: 'Umas', UmaResolutionNote: 'Resolution',
    formatRecord: () => '-', formatPercent: () => '-', formatDecimal: () => '-', formatNumber: () => '-'
  });
  loadFunction(c, teamSectionSyntax, 'CardBody');
  const tree = c.CardBody({ state: 'loaded', player: { displayName: 'Fixture' },
    displayedProfile: undefined, notableBadges: [], note: 'Profile data has not loaded yet.',
    statsMessage: 'Profile data has not loaded yet.', canRetryProfile: false });
  const statuses = findAll(tree, node => node.children?.includes?.('Profile data has not loaded yet.'));
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].props.className, 'card-message-title');
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

test('the team header shows a 4px team-accent bar, a 20px/700 team name in the display font, and a flexible divider before the average rating', () => {
  const css = readModule('uiLobbyCss');
  assert.match(css, /\.team-header-accent\s*\{[^}]*width:\s*4px[^}]*\}/s);
  assert.match(css, /\.team-header-accent\s*\{[^}]*height:\s*20px/s);
  assert.match(css, /\.team-header h2\s*\{[^}]*font-size:\s*20px/s);
  assert.match(css, /\.team-header h2\s*\{[^}]*font-weight:\s*700/s);
  assert.match(css, /\.team-header h2\s*\{[^}]*font-family:\s*var\(--font-display\)/s);
  assert.match(css, /\.team-header-divider\s*\{[^}]*flex-grow:\s*1/s, 'the divider between the name and the average must stretch to fill the row');
  assert.match(css, /\.team-header-avg strong\s*\{[^}]*font-weight:\s*700/s);
});

test('lobby spacing matches the mockup: 12px from a team header to its cards, 22px between teams', () => {
  const lobbyCss = readModule('uiLobbyCss');
  assert.match(lobbyCss, /\.team-section\s*\{[^}]*gap:\s*12px/s);

  const baseCss = readModule('uiCommonBaseCss');
  assert.match(baseCss, /\.team-list\s*\{[^}]*gap:\s*22px/s);
});

test('the Most Played list reveals whole Uma rows only: it hides all rows by default and a container query reveals one more full row at a time, never a partial one', () => {
  const css = readModule('uiCommonBaseCss');
  assert.match(css, /\.top-umas-rows li\s*\{[^}]*display:\s*none/s, 'rows are hidden until the container has room for them');
  assert.match(css, /\.top-umas-rows\s*\{[^}]*overflow:\s*hidden/s);
  const revealedCounts = Array.from(css.matchAll(/@container top-umas-rows \(min-height:\s*(\d+)px\)\s*\{\s*\.top-umas-rows li:nth-child\(-n\+(\d+)\)\s*\{\s*display:\s*grid/g))
    .map((match) => [Number(match[1]), Number(match[2])]);
  assert.equal(revealedCounts.length, 5, 'one threshold per row, up to the 5-row maximum');
  assert.deepEqual(revealedCounts.map(([, rowCount]) => rowCount), [1, 2, 3, 4, 5]);
  for (let i = 1; i < revealedCounts.length; i += 1) {
    assert(revealedCounts[i][0] > revealedCounts[i - 1][0], 'each extra row requires strictly more height than the last');
  }
});

test('the details drawer is a fixed 600px overlay, not a page it never scrolls as a whole', () => {
  const css = readModule('uiPlayerDrawerCss');
  assert.match(css, /\.player-drawer\s*\{[^}]*width:\s*min\(var\(--drawer-width\), 100vw\)/s);
  assert.match(css, /\.player-drawer\s*\{[^}]*overflow:\s*hidden/s);
});

test('the history region can shrink and the pager stays pinned, so short viewports never clip the pager', () => {
  const css = readModule('uiPlayerDrawerCss');
  assert.match(css, /\.drawer-history\s*\{[^}]*min-height:\s*0/s,
    'the history section must be allowed to shrink below its content size in a flex column');
  assert.match(css, /\.drawer-pager\s*\{[^}]*flex-shrink:\s*0/s,
    'the pager must never be squeezed out when the drawer runs short on vertical space');
});

test('match history rows flex to fill the space above the pager, bounded between 46px and 64px, so the pager stays pinned at the bottom without a trailing gap', () => {
  const css = readModule('uiPlayerDrawerCss');
  assert.match(css, /\.drawer-history-row,\s*\n?\s*\.drawer-history-row-skel\s*\{[^}]*flex:\s*1 1 0/s);
  assert.match(css, /\.drawer-history-row,\s*\n?\s*\.drawer-history-row-skel\s*\{[^}]*min-height:\s*46px/s);
  assert.match(css, /\.drawer-history-row,\s*\n?\s*\.drawer-history-row-skel\s*\{[^}]*max-height:\s*64px/s);
});

test('the Umas panel no longer prints the long history-derived paragraph; it renders nothing for that case', () => {
  const c = vm.createContext({
    element: (type, props, ...children) => ({ type, props, children })
  });
  loadFunction(c, topUmasListSyntax, 'UmaResolutionNote');
  assert.equal(c.UmaResolutionNote({ profile: { historyDerived: true, unresolvedUmaMatches: 3, disqualifiedMatches: 1 } }), null,
    'history-derived profiles render nothing here now, even if they also have unresolved/disqualified matches');
  assert.equal(c.UmaResolutionNote({ profile: undefined }), null);
});

test('EstimatedChip labels itself "Estimated" and its tooltip explains history-derived stats, adding the match count only from historyDerivedMatchCount, never historyTotal or matches', () => {
  const c = drawerHarness();
  const withCount = c.EstimatedChip({ profile: { historyDerived: true, historyDerivedMatchCount: 87, historyTotal: 999, matches: 999 } });
  const label = withCount.children[0];
  const tooltip = withCount.children.find((child) => child?.props?.role === 'tooltip');
  assert.equal(label, 'Estimated');
  assert.deepEqual(tooltip.children, ['Stats worked out from match history (up to 100 matches per scope)', ' · 87 matches'],
    'historyDerivedMatchCount wins even when historyTotal/matches are also present');

  const ignoresHistoryTotalAndMatches = c.EstimatedChip({ profile: { historyDerived: true, historyTotal: 87, matches: 42 } });
  assert.deepEqual(ignoresHistoryTotalAndMatches.children.find((child) => child?.props?.role === 'tooltip').children,
    ['Stats worked out from match history (up to 100 matches per scope)', ''],
    'historyTotal and matches must never be used as the count, only historyDerivedMatchCount');

  const withoutCount = c.EstimatedChip({ profile: { historyDerived: true } });
  assert.deepEqual(withoutCount.children.find((child) => child?.props?.role === 'tooltip').children,
    ['Stats worked out from match history (up to 100 matches per scope)', '']);
});

test('the drawer stat row places the Estimated chip beside (not inside) the four-cell stat panel, only for history-derived profiles', () => {
  const notDerived = renderableDrawer({ discordId: '1' }).render();
  const derived = renderableDrawer({ discordId: '1', historyDerived: true, historyTotal: 60 }).render();

  const statRow = find(derived, (node) => node.props?.className === 'drawer-stat-row');
  assert(statRow !== undefined, 'the stat panel and chip share a row wrapper');
  const rowChildren = statRow.children.flat(Infinity).filter(Boolean);
  const statPanel = rowChildren.find((node) => node?.props?.className === 'drawer-stat-panel');
  assert(statPanel !== undefined, 'the four-cell stat panel is still rendered inside the row');
  assert.equal(rowChildren.length, 2, 'a history-derived profile adds exactly one sibling (the chip) beside the panel');

  const notDerivedRow = find(notDerived, (node) => node.props?.className === 'drawer-stat-row');
  assert.equal(notDerivedRow.children.flat(Infinity).filter(Boolean).length, 1,
    'without historyDerived, only the stat panel sits in the row, no chip');
});

test('the Estimated chip tooltip appears on hover/focus only, and is not clipped by the drawer\'s own overflow:hidden', () => {
  const css = readModule('uiPlayerDrawerCss');
  assert.match(css, /\.drawer-estimated-chip\s*\{[^}]*color:\s*var\(--accent-gold\)/s, 'the chip is gold');
  assert.match(
    css,
    /\.drawer-estimated-chip:hover \.drawer-estimated-tooltip,\s*\n?\s*\.drawer-estimated-chip:focus-visible \.drawer-estimated-tooltip/,
    'tooltip only reveals on hover or focus, never a bare click'
  );
  assert.match(css, /\.drawer-estimated-tooltip\s*\{[^}]*top:\s*calc\(100% \+ 8px\)/s,
    'opens downward, away from the header, so overflow:hidden on .player-drawer cannot clip it');
});

test('the team average rating uses each player\'s displayed rating (profile conservative/rating, then snapshot fallbacks) and shows an em dash with no ratings', () => {
  const c = vm.createContext({});
  loadFunction(c, teamSectionSyntax, 'getPlayerDisplayRating');
  loadFunction(c, teamSectionSyntax, 'getTeamAverageRating');

  const team = {
    id: 'team1',
    players: [
      { discordId: 'a', ratingSnapshot: 1000 },
      { discordId: 'b', displayRatingSnapshot: 1200 },
      { discordId: 'c' }
    ]
  };
  const profiles = { b: { rating: 1400 }, c: { conservativeRating: 1600, rating: 1800 } };

  assert.equal(c.getTeamAverageRating(team, profiles), Math.round((1000 + 1400 + 1600) / 3));
  assert.equal(c.getTeamAverageRating({ id: 'team2', players: [{ discordId: 'z' }] }, {}), undefined,
    'no player has any resolvable rating, so the average is undefined (rendered as an em dash)');
});

test('the Umas table excludes players with fewer than MIN_UMA_GAMES by default, paginates 5 per page, and resets to page 1 when the sort or the low-games filter changes', () => {
  const uma = (name, matches, ppg) => ({
    umaId: name, name, matches, wins: 0, losses: 0, winRate: 0.5, points: 0, pointsPerGame: ppg, podiums: 0, mvpMatches: 0
  });
  const profile = {
    discordId: '123456789012345678', displayName: 'Fixture',
    allUmas: [
      uma('A', 10, 9), uma('B', 9, 8), uma('C', 8, 7), uma('D', 7, 6), uma('E', 6, 5), uma('F', 5, 4),
      uma('G', 2, 1), uma('H', 1, 0.5)
    ]
  };
  const { render } = renderableDrawer(profile);

  const rowNames = (tree) => findAll(tree, (n) => n.props?.className === 'uma-table-row')
    .map((row) => find(row, (n) => n.props?.className === 'uma-name').children[0]);
  const pagerRange = (tree) => find(tree, (n) => n.props?.className === 'uma-pager-range')?.children?.join('');
  const lowGamesToggle = (tree) => find(tree, (n) => n.props?.className === 'drawer-toggle-button');

  const first = render();
  assert.deepEqual(rowNames(first), ['A', 'B', 'C', 'D', 'E'], 'the 6 Umas with >=3 games fill page 1, sorted by PPG desc');
  assert.equal(pagerRange(first), '1–5 of 6');
  assert.equal(lowGamesToggle(first).children[0], '+2 with <3 games');

  const nextButton = find(first, (n) => n.props?.['aria-label'] === 'Next Umas');
  nextButton.props.onClick();
  const secondPage = render();
  assert.deepEqual(rowNames(secondPage), ['F'], 'page 2 holds the remaining filtered Uma');
  assert.equal(pagerRange(secondPage), '6–6 of 6');

  lowGamesToggle(secondPage).props.onClick();
  const revealed = render();
  assert.deepEqual(rowNames(revealed), ['A', 'B', 'C', 'D', 'E'], 'toggling the low-games filter resets to page 1');
  assert.equal(pagerRange(revealed), '1–5 of 8', 'all 8 Umas now count, including the 2 with <3 games');
  assert.equal(lowGamesToggle(revealed).children[0], 'Hide <3 games');

  nextButton.props.onClick();
  const revealedPage2 = render();
  assert.deepEqual(rowNames(revealedPage2), ['F', 'G', 'H'], 'page 2 of all 8 Umas holds the remaining 3 after the top 5');

  const gpSortButton = find(revealedPage2, (n) => n.props?.className?.startsWith?.('th') && n.children[0] === 'GP');
  gpSortButton.props.onClick();
  const afterSortChange = render();
  assert.equal(pagerRange(afterSortChange), '1–5 of 8', 'changing the sort column resets paging back to page 1');
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
    HISTORY_PAGE_SIZE: 5, HISTORY_API_PAGE_SIZE: 20, UMA_TABLE_ROWS: 5, PAGER_SLOT_COUNT: 7, MIN_UMA_GAMES: 3,
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
  loadFunction(c, playerDrawerSyntax, 'apiPageForPagerPage');
  loadFunction(c, playerDrawerSyntax, 'apiPageRowOffset');
  loadFunction(c, playerDrawerSyntax, 'PlayerDrawer');
  loadFunction(c, playerDrawerSyntax, 'EstimatedChip');
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

test('public drawer displays history without deriving a Consistent badge from its matches', async () => {
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
  assert(!badgesAfter.includes('Consistent'), 'displayed history must not create derived public stats');
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
