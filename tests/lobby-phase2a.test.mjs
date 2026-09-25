import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadFunction, parseTsxModule, readModule } from './support/harness.mjs';

const teamSectionSyntax = parseTsxModule('uiLobbyTeamSection');
const badgeChipSyntax = parseTsxModule('uiLobbyBadgeChip');
const playerDrawerSyntax = parseTsxModule('uiPlayerDrawer');

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

test('the details drawer is a fixed 600px overlay, not a page it never scrolls as a whole', () => {
  const css = readModule('uiPlayerDrawerCss');
  assert.match(css, /\.player-drawer\s*\{[^}]*width:\s*min\(var\(--drawer-width\), 100vw\)/s);
  assert.match(css, /\.player-drawer\s*\{[^}]*overflow:\s*hidden/s);
});
