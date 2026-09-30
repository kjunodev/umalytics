import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadFunction, loadModule, loadModuleTS, parseTsxModule, readModule } from './support/harness.mjs';
import { PREVIEW_PROFILES, PREVIEW_LEADERBOARD, discordId } from '../apps/extension/dev/preview/fixtures.ts';

const element = (type, props, ...children) => ({ type, props, children });
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
const tick = () => new Promise(resolve => setImmediate(resolve));

// A minimal hook runtime: state survives re-renders, effects are recorded so a
// test can run them by hand.
function hookRuntime(context) {
  const states = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  context.useState = initial => {
    const index = stateIndex++;
    if (states[index] === undefined) states[index] = [initial, update => {
      states[index][0] = typeof update === 'function' ? update(states[index][0]) : update;
    }];
    return states[index];
  };
  context.useRef = initial => {
    const index = refIndex++;
    if (refs[index] === undefined) refs[index] = { current: initial };
    return refs[index];
  };
  context.useEffect = callback => { effects[effectIndex++] = callback; };
  return { states, effects, reset: () => { stateIndex = refIndex = effectIndex = 0; } };
}

// --- (1) Team-icon tooltip placement ---

const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const inside = (placement, size, bounds) => placement.left >= bounds.left && placement.top >= bounds.top
  && placement.left + size.width <= bounds.right && placement.top + size.height <= bounds.bottom;

function placementContext() {
  const c = vm.createContext({});
  loadModule(c, 'uiCommonTooltipPlacement');
  return c;
}

test('team icon tooltip opens below the icon when the card has room', () => {
  const c = placementContext();
  const card = box(0, 0, 220, 300), icon = box(100, 20, 122, 42), size = { width: 150, height: 28 };
  const placement = c.computeTooltipPlacement(icon, size, card, 6, 4);
  assert.equal(placement.side, 'below');
  assert.equal(placement.top, 42 + 6);
  assert.ok(inside(placement, size, card));
});

test('team icon tooltip slides sideways to stay inside the card and opens above when there is no room below', () => {
  const c = placementContext();
  const card = box(0, 0, 220, 300), size = { width: 190, height: 28 };
  const right = c.computeTooltipPlacement(box(190, 20, 212, 42), size, card, 6, 4);
  assert.equal(right.side, 'below');
  assert.ok(inside(right, size, card), 'an icon near the right edge must not push the tooltip out of the card');
  const bottom = c.computeTooltipPlacement(box(20, 260, 42, 282), size, card, 6, 4);
  assert.equal(bottom.side, 'above');
  assert.equal(bottom.top, 260 - 6 - 28);
});

test('in a short leaderboard row the tooltip goes beside the icon, never onto the next row', () => {
  const c = placementContext();
  const row = box(0, 100, 900, 144), icon = box(80, 111, 102, 133), size = { width: 210, height: 28 };
  const placement = c.computeTooltipPlacement(icon, size, row, 6, 4);
  assert.equal(placement.side, 'right');
  assert.ok(inside(placement, size, row), 'the tooltip must stay within the 44px row');
  assert.equal(placement.left, 102 + 6);
});

test('team icon tooltip falls back to the least-overflowing side, clamped into the container', () => {
  const c = placementContext();
  const tiny = box(0, 0, 100, 40), size = { width: 92, height: 30 };
  const placement = c.computeTooltipPlacement(box(40, 8, 62, 30), size, tiny, 6, 4);
  assert.ok(placement.left >= 4 && placement.left + size.width <= 96);
  assert.ok(placement.top >= 4 && placement.top + size.height <= 36);
});

test('TeamIcon places its tooltip on hover and keyboard focus only, and anchors it to the icon', () => {
  const tsx = readModule('uiCommonTeamIcon');
  assert.match(tsx, /onMouseEnter=\{place\}/);
  assert.match(tsx, /onFocus=\{place\}/);
  const css = readModule('uiCommonBaseCss');
  assert.match(css, /\.team-icon:hover \.team-icon-tooltip,\s*\.team-icon:focus-visible \.team-icon-tooltip/);
  assert.match(css.match(/\.team-icon \{[^}]*\}/)[0], /position: relative/);
  const tooltipRule = css.match(/\.team-icon-tooltip \{[^}]*\}/)[0];
  assert.match(tooltipRule, /position: absolute/);
  assert.match(tooltipRule, /width: max-content/);
  for (const name of ['uiLobbyCss', 'uiPlayersCss', 'uiPlayerDrawerCss']) {
    assert.doesNotMatch(readModule(name), /team-icon-tooltip\s*\{/, `${name} must not re-anchor the tooltip to its row`);
  }
});

// --- (2) Season display name ---

test('formatSeasonLabel shows the season name and falls back to "Current season"', () => {
  const c = vm.createContext({ getTeamGroups: () => [], URL });
  loadModule(c, 'explorerData');
  loadModule(c, 'uiPlayersData');
  assert.equal(c.formatSeasonLabel('Season 2 (Grand Concert)'), 'Season 2 (Grand Concert)');
  assert.equal(c.formatSeasonLabel('  Season 1 (Trackblazer) '), 'Season 1 (Trackblazer)');
  for (const missing of [undefined, '', '   ']) assert.equal(c.formatSeasonLabel(missing), 'Current season');
});

test('the Players header renders the season name, never the raw season id', () => {
  const view = readModule('uiPlayersView');
  assert.match(view, /formatSeasonLabel\(leaderboardState\.data\.activeSeasonName\)/);
  assert.doesNotMatch(view, /Season \{leaderboardState\.data\.activeSeasonId\}/);
});

// --- (3) Match code opens History ---

const MATCH = { matchId: 'FIX001', reportedAt: '2026-09-18T12:00:00Z', mode: 'ranked', verificationState: 'confirmed', umaId: null, umaName: 'Unknown Uma', isWinner: true, pointsScored: 3, podiums: 1, isMvp: false };
function drawerProfile() {
  const stats = { matches: 1, recentMatches: [MATCH], recentHistoryStatus: 'loaded', recentHistoryVersion: 6 };
  return { discordId: '123456789012345678', displayName: 'Fixture', profileUrl: '', fetchedAt: Date.now(), activeSeasonId: 'S1', statsScope: 'allTime',
    scopeFetchedAt: { allTime: Date.now() }, bestUmaScoreVersion: 17, recentHistoryVersion: 6, ...stats,
    allTimeStats: stats, currentSeasonStats: { recentMatches: [], recentHistoryVersion: 6 } };
}

async function renderDrawer(onOpenMatch, onClose) {
  const c = vm.createContext({ console, element,
    getLookupDiscordId: p => p.discordId, getPlayerNote: () => undefined, getStatsMessage: () => undefined,
    getNotableBadges: () => [], getPlayerPartyVisual: () => undefined, getTeamPartyVisuals: () => ({}),
    formatRank: () => '', formatRecord: () => '', formatPercent: () => '', formatDecimal: () => '', formatNumber: () => '',
    getRecentResultTone: () => 'win', formatRecentResult: () => 'W',
    ProfileDataStatus: 'Status', StatCell: 'Stat', BestUmaPortrait: 'Portrait', UmaImage: 'Image', TeamIcon: 'TeamIcon',
    getFallbackUmaImageUrl: () => undefined,
    getPagerSlots: (page, total) => Array.from({ length: total }, (_, i) => i + 1),
    umaSortValue: () => 0, formatUmaColumnValue: () => '-',
    HISTORY_PAGE_SIZE: 5, HISTORY_API_PAGE_SIZE: 20, UMA_TABLE_ROWS: 5, PAGER_SLOT_COUNT: 7, MIN_UMA_GAMES: 3,
    UMA_SORT_COLUMNS: [{ key: 'matches', label: 'GP' }],
    React: { Fragment: 'Fragment' }, crypto: { randomUUID: () => 'request-1' },
    filterProfileStatesForDisplay: x => x, getLoadingDiscordIdsForDisplay: () => [] });
  const runtime = hookRuntime(c);
  for (const name of ['profileConstants', 'profileMerge', 'profileCache', 'explorerState']) loadModuleTS(c, name);
  const display = parseTsxModule('uiPlayerProfileDisplay');
  const drawer = parseTsxModule('uiPlayerDrawer');
  loadFunction(c, display, 'getDisplayedProfileStats');
  loadFunction(c, display, 'withDetailHistory');
  for (const name of ['apiPageForPagerPage', 'apiPageRowOffset', 'PlayerDrawer']) loadFunction(c, drawer, name);
  const profile = drawerProfile();
  c.sendPlayerHistoryPageRequest = async (_, __, page) => ({ page, total: 1, matches: [MATCH] });
  c.cancelPlayerHistoryPageRequest = async () => {};
  c.sendPlayerProfileRequest = async () => ({ title: null });
  c.cancelPlayerProfileRequest = async () => {};
  const render = () => {
    runtime.reset();
    return c.PlayerDrawer({ player: { discordId: profile.discordId, displayName: 'Fixture' }, profile,
      context: { statsScope: 'allTime', isProfileLoading: false, now: Date.now(), onOpenMatch }, onClose });
  };
  render();
  runtime.effects[0]();
  await tick();
  return render();
}

test('clicking a drawer match code opens it in History and closes the drawer', async () => {
  const opened = []; let closed = 0;
  const rendered = await renderDrawer(code => opened.push(code), () => { closed++; });
  const code = find(rendered, n => n.type === 'button' && n.props?.className === 'recent-match-code');
  assert.ok(code, 'the code is a button, not a link to drafter.uma.guide');
  assert.deepEqual(code.children.flat(), ['FIX001']);
  code.props.onClick();
  assert.deepEqual(opened, ['FIX001']);
  assert.equal(closed, 1);
});

test('each code keeps an external link to the Uma Drafter match page, in a new tab with a tooltip', async () => {
  const rendered = await renderDrawer(() => {}, () => {});
  const link = find(rendered, n => n.type === 'a' && n.props?.className === 'recent-match-external');
  assert.ok(link);
  assert.equal(link.props.href, 'https://drafter.uma.guide/matches/FIX001');
  assert.equal(link.props.target, '_blank');
  assert.equal(link.props.rel, 'noreferrer');
  assert.equal(link.props.title, 'Open on Uma Drafter');
  assert.match(link.props['aria-label'], /FIX001/);
  assert.equal(findAll(rendered, n => n.type === 'a' && n.props?.className === 'recent-match-code').length, 0);
});

test('without an open-match handler the code still links out to Uma Drafter', async () => {
  const rendered = await renderDrawer(undefined, () => {});
  const link = find(rendered, n => n.type === 'a' && n.props?.className === 'recent-match-code');
  assert.equal(link.props.href, 'https://drafter.uma.guide/matches/FIX001');
});

test('HistoryView loads a requested match code through the same path as typing it, once per request', async () => {
  const loads = [], codes = [];
  const c = vm.createContext({ console, element, AbortController, React: { Fragment: 'Fragment' },
    EMPTY_PLAYERS: [],
    useProfiles: () => ({ profiles: {}, loading: false, error: '', retry() {} }),
    loadHistoricalMatch: async (value) => { loads.push(value); return { matchCode: String(value).toUpperCase(), roster: { players: [] }, draft: {}, warnings: [] }; } });
  const runtime = hookRuntime(c);
  loadFunction(c, parseTsxModule('uiHistoryExplorerViews'), 'HistoryView');
  let requestedMatch;
  const render = () => { runtime.reset(); return c.HistoryView({ Scene: 'Scene', scene: 'lobby', scope: 'currentSeason', navigation: 0, onMatchCodeChange: code => codes.push(code), requestedMatch }); };
  render();
  runtime.effects[1]();
  await tick();
  assert.deepEqual(loads, [], 'no request, no load');
  requestedMatch = { code: 'tg7yt2', nonce: 1 };
  render();
  runtime.effects[1]();
  await tick();
  assert.deepEqual(loads, ['tg7yt2']);
  assert.equal(runtime.states[0][0], 'tg7yt2', 'the code also appears in the History input');
  assert.equal(codes.at(-1), 'TG7YT2');
  assert.equal(runtime.states[1][0].matchCode, 'TG7YT2');
});

test('App switches to History mode, closes the live drawer and hands the code to every drawer host', () => {
  const app = readModule('scoutApp');
  const handler = app.match(/const openMatchInHistory = [\s\S]*?\n {2}\};/)[0];
  assert.match(handler, /setRequestedMatch/);
  assert.match(handler, /setSelectedPlayerKey\(undefined\)/);
  assert.match(handler, /setMode\('history'\)/);
  assert.match(app, /requestedMatch=\{requestedMatch\}/);
  assert.match(app, /onOpenMatch=\{openMatchInHistory\}/);
  assert.match(app, /onOpenMatch: openMatchInHistory/);
  assert.match(readModule('uiHistoryScene'), /inLobby: false[^}]*onOpenMatch/);
});

// --- (4) Rating = rating - RD ---

function playersData() {
  const c = vm.createContext({ getTeamGroups: () => [], URL, formatNumber: v => String(v), formatPercent: v => String(v) });
  loadModule(c, 'explorerData');
  loadModule(c, 'uiPlayersData');
  return c;
}
const row = (rank, userId, rating, rd, wins = 1, losses = 1) => ({ rank, userId, rating, rd, wins, losses });

test('leaderboardDisplayRating is rating minus RD, rounded, and falls back to the raw rating without an RD', () => {
  const c = playersData();
  assert.equal(c.leaderboardDisplayRating(row(1, 'a', 1834, 123)), 1711);
  assert.equal(c.leaderboardDisplayRating(row(1, 'a', 1834.4, 122.6)), 1712);
  assert.equal(c.leaderboardDisplayRating(row(1, 'a', 1834, undefined)), 1834);
  assert.equal(c.leaderboardDisplayRating(row(1, 'a', undefined, 50)), undefined);
});

test('the Rating column sorts by rating minus RD while Rank stays as provided', () => {
  const c = playersData();
  // Raw ratings would order a, b, c; the conservative ratings order c, b, a.
  const entries = [row(1, 'a', 1900, 300), row(2, 'b', 1850, 150), row(3, 'c', 1800, 50), row(4, 'd', undefined, undefined)];
  assert.deepEqual(Array.from(c.sortLeaderboardEntries(entries, 'rating'), e => e.userId), ['c', 'b', 'a', 'd']);
  assert.deepEqual(Array.from(c.sortLeaderboardEntries(entries, 'rank'), e => e.userId), ['a', 'b', 'c', 'd']);
  assert.deepEqual(Array.from(entries, e => e.rank), [1, 2, 3, 4], 'rank values are never recomputed');
  const tied = [row(2, 'x', 1700, 0), row(1, 'y', 1750, 50)];
  assert.deepEqual(Array.from(c.sortLeaderboardEntries(tied, 'rating'), e => e.userId), ['y', 'x'], 'ties keep rank order');
});

test('the leaderboard row shows the conservative rating and keeps the "Rating" label', () => {
  const view = readModule('uiPlayersView');
  assert.match(view, /formatNumber\(leaderboardDisplayRating\(entry\) \?\? null\)/);
  assert.match(view, /\{ key: 'rating', label: 'Rating' \}/, 'the rest of the UI says "rating", not "ELO"');
});

test('preview leaderboard fixture exercises the season name and rating - RD', () => {
  assert.equal(PREVIEW_LEADERBOARD.activeSeasonName, 'Season 4 (Preview Series)');
  assert.ok(PREVIEW_LEADERBOARD.entries.every(e => e.rd > 0));
});

// --- (5) W-L never wraps ---

test('a triple-digit W-L fixture exists and the stat grid gives the W-L column the most room without wrapping', () => {
  const heavy = PREVIEW_PROFILES[discordId(7)];
  assert.equal(`${heavy.wins}-${heavy.losses}`, '999-999');
  assert.equal(heavy.winRate, 1);
  const css = readModule('uiCommonBaseCss');
  assert.match(css, /--stat-grid-columns: minmax\(0, 1\.4fr\) minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 0\.9fr\)/);
  const cardValue = css.match(/\.player-row \.compact-scouting-grid \.stat-cell strong \{[^}]*\}/)[0];
  assert.match(cardValue, /white-space: nowrap/);
  assert.doesNotMatch(cardValue, /overflow-wrap: anywhere/);
  assert.match(css, /\.compact-scouting-grid \.record-stat-cell \{[^}]*container-type: inline-size/);
  assert.match(css, /@container \(max-width: 45px\) \{\s*\.compact-scouting-grid \.record-stat-cell strong \{\s*font-size: calc\(var\(--font-step-sm\) \* 0\.85\)/,
    'the W-L value steps down to 85% at most, via a container query');
  const drawer = readModule('uiPlayerDrawerCss');
  assert.match(drawer, /\.drawer-stat-panel \{[^}]*grid-template-columns: minmax\(0, 1\.3fr\)/);
  assert.match(drawer, /\.drawer-stat-panel \.stat-cell strong \{[^}]*white-space: nowrap/);
});

// --- (6) Draft scene balance ---

test('draft columns stretch to one height and widen the Races column down to the existing breakpoint', () => {
  const css = readModule('uiDraftCss');
  const columns = css.match(/\.draft-columns \{[^}]*\}/)[0];
  assert.match(columns, /align-items: stretch/);
  assert.match(columns, /grid-template-columns: minmax\(0, 1fr\) minmax\(360px, 1\.15fr\) minmax\(0, 1fr\)/);
  assert.match(css, /@container scene \(max-width: 1099px\)/);
  assert.match(css.match(/\.draft-race-mods \{[^}]*\}/)[0], /flex-wrap: nowrap/);
  assert.match(css.match(/\.draft-mod \{[^}]*\}/)[0], /white-space: nowrap/);
});

test('the Races legend sits on its own line under the title with one entry per team', () => {
  const c = vm.createContext({ element, React: { Fragment: 'Fragment' }, TEAM_IDS: ['team1', 'team2'],
    formatTeamName: team => team.name, formatRaceTrackName: () => '', formatRaceDistance: () => undefined,
    hasStructuredRaceModifiers: () => false, getDraftWeatherIconKey: () => undefined, formatDraftMapDetails: () => undefined });
  loadFunction(c, parseTsxModule('uiDraftScene'), 'DraftRacesPanel');
  const panel = c.DraftRacesPanel({ teams: { team1: { name: 'Rose Tempest' }, team2: { name: 'vietnamese falcon' } }, races: [], tiebreakerMap: undefined, vetoedMaps: [] });
  const [header, legend] = panel.children;
  assert.equal(header.props.className, 'draft-races-header');
  assert.equal(findAll(header, n => String(n.props?.className).includes('legend')).length, 0, 'no legend beside the title');
  assert.equal(legend.props.className, 'draft-races-legend');
  assert.deepEqual(findAll(legend, n => n.props?.className === 'draft-team-legend-name').map(n => n.children.flat()[0]), ['Rose Tempest', 'vietnamese falcon']);
});

test('the weather chip keeps its full label as a tooltip; other chips stay text', () => {
  const c = vm.createContext({ element, DraftWeatherIcon: 'WeatherIcon' });
  loadFunction(c, parseTsxModule('uiDraftScene'), 'DraftModChipView');
  const weather = c.DraftModChipView({ chip: { label: 'Cloudy', tone: 'weather-cloudy' }, iconKey: 'cloudy' });
  assert.equal(weather.props.title, 'Cloudy');
  assert.equal(find(weather, n => n.props?.className === 'draft-mod-label').children.flat()[0], 'Cloudy');
  const surface = c.DraftModChipView({ chip: { label: 'Turf', tone: 'surface-turf' } });
  assert.equal(surface.props.title, undefined);
});
