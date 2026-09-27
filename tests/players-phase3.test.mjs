import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModule, readModule } from './support/harness.mjs';

function playersDataContext() {
  const context = vm.createContext({
    URL,
    getTeamGroups: roster => roster?.teams ? Object.values(roster.teams) : [],
    formatNumber: value => value === undefined || value === null ? '-' : String(value),
    formatPercent: value => value === undefined || value === null ? '-' : `${Math.round(value * 100)}%`
  });
  // playersData.ts reuses explorerData's ID/URL detection and player lookup.
  loadModule(context, 'explorerData');
  loadModule(context, 'uiPlayersData');
  return context;
}

const entry = (rank, userId, displayName, rating, wins, losses) => ({ rank, userId, displayName, rating, wins, losses });

test('classifyPlayerQuery filters by plain text', () => {
  const c = playersDataContext();
  const result = c.classifyPlayerQuery('Simon');
  assert.equal(result.mode, 'filter');
  assert.equal(result.text, 'Simon');
});

test('classifyPlayerQuery detects a raw 16-20 digit Discord ID as a lookup', () => {
  const c = playersDataContext();
  const lookup = c.classifyPlayerQuery('123456789012345678');
  assert.equal(lookup.mode, 'lookup');
  assert.equal(lookup.id, '123456789012345678');
  // 15 digits is too short to be a snowflake, so it falls back to a text filter.
  const short = c.classifyPlayerQuery('12345678901234');
  assert.equal(short.mode, 'filter');
  assert.equal(short.text, '12345678901234');
});

test('classifyPlayerQuery detects a drafter profile URL as a lookup', () => {
  const c = playersDataContext();
  const result = c.classifyPlayerQuery('https://drafter.uma.guide/players/123456789012345678');
  assert.equal(result.mode, 'lookup');
  assert.equal(result.id, '123456789012345678');
});

test('classifyPlayerQuery never throws on input explorerData rejects, and falls back to a filter', () => {
  const c = playersDataContext();
  // A single character is below explorerData's 2-80 character minimum and would throw.
  const tooShort = c.classifyPlayerQuery('a');
  assert.equal(tooShort.mode, 'filter');
  assert.equal(tooShort.text, 'a');
  // An unsupported URL host also throws inside parsePlayerInput.
  const badHost = c.classifyPlayerQuery('https://example.com/players/123');
  assert.equal(badHost.mode, 'filter');
  assert.equal(badHost.text, 'https://example.com/players/123');
});

test('filterLeaderboardEntries matches names case-insensitively and keeps everything for an empty query', () => {
  const c = playersDataContext();
  const entries = [entry(1, '1', 'Constellations'), entry(2, '2', 'baneta'), entry(3, '3', 'Yunaka')];
  assert.deepEqual(Array.from(c.filterLeaderboardEntries(entries, 'BANE'), e => e.userId), ['2']);
  assert.deepEqual(Array.from(c.filterLeaderboardEntries(entries, '   '), e => e.userId), ['1', '2', '3']);
  assert.equal(c.filterLeaderboardEntries(entries, 'zzz').length, 0);
});

test('sortLeaderboardEntries sorts by rank, rating, win rate and games, with missing data sorted last', () => {
  const c = playersDataContext();
  const entries = [
    entry(3, 'c', 'Charlie', 1200, 5, 5),   // 50% win rate, 10 games
    entry(1, 'a', 'Alpha', 1500, 8, 2),     // 80% win rate, 10 games
    entry(2, 'b', 'Bravo', undefined, undefined, undefined) // no rating/games recorded
  ];
  const ids = key => Array.from(c.sortLeaderboardEntries(entries, key), e => e.userId);
  assert.deepEqual(ids('rank'), ['a', 'b', 'c']);
  assert.deepEqual(ids('rating'), ['a', 'c', 'b']);
  assert.deepEqual(ids('win'), ['a', 'c', 'b']);
  assert.deepEqual(ids('games'), ['a', 'c', 'b']);
});

test('sortLeaderboardEntries breaks ties by rank', () => {
  const c = playersDataContext();
  const entries = [entry(5, 'x', 'X', 1000, 2, 2), entry(2, 'y', 'Y', 1000, 2, 2)];
  assert.deepEqual(Array.from(c.sortLeaderboardEntries(entries, 'rating'), e => e.userId), ['y', 'x']);
});

test('pushRecentPlayer caps the list at 4, moves re-opened players to the front, and de-dupes by id', () => {
  const c = playersDataContext();
  let recent = [];
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
  names.forEach((name, index) => {
    recent = c.pushRecentPlayer(recent, { discordId: String(index), displayName: name });
  });
  assert.equal(recent.length, 4);
  assert.deepEqual(Array.from(recent, r => r.displayName), ['Echo', 'Delta', 'Charlie', 'Bravo']);

  // Re-opening an existing recent player moves it to the front without growing the list or duplicating it.
  recent = c.pushRecentPlayer(recent, { discordId: '2', displayName: 'Charlie' });
  assert.equal(recent.length, 4);
  assert.deepEqual(Array.from(recent, r => r.displayName), ['Charlie', 'Echo', 'Delta', 'Bravo']);
});

test('leaderboardEntryToPlayer reuses explorerData.lookupPlayer for a valid userId', () => {
  const c = playersDataContext();
  const player = c.leaderboardEntryToPlayer(entry(1, '123456789012345678', 'Constellations', 1500, 10, 2));
  assert.equal(player.discordId, '123456789012345678');
  assert.equal(player.displayName, 'Constellations');
  assert.equal(player.profileUrl, 'https://drafter.uma.guide/players/123456789012345678');
});

test('rankTintClass tints only the top 3 ranks', () => {
  const c = playersDataContext();
  assert.equal(c.rankTintClass(1), 'players-rank-gold');
  assert.equal(c.rankTintClass(2), 'players-rank-silver');
  assert.equal(c.rankTintClass(3), 'players-rank-bronze');
  assert.equal(c.rankTintClass(4), undefined);
});

test('findRosterTeamForPlayer locates the current lobby team for a player, or undefined otherwise', () => {
  const c = playersDataContext();
  const player = { discordId: '111', userId: '111', displayName: 'Someone' };
  const roster = { players: [player], teams: {
    team1: { id: 'team1', players: [player] },
    team2: { id: 'team2', players: [] }
  } };
  assert.equal(c.findRosterTeamForPlayer(roster, '111')?.id, 'team1');
  assert.equal(c.findRosterTeamForPlayer(roster, '999'), undefined);
  assert.equal(c.findRosterTeamForPlayer(undefined, '111'), undefined);
});

test('shouldLoadLeaderboard never fetches while inactive, regardless of cache age', () => {
  const c = playersDataContext();
  const now = 1_000_000;
  assert.equal(c.shouldLoadLeaderboard(false, undefined, now), false);
  assert.equal(c.shouldLoadLeaderboard(false, now - 1, now), false);
  assert.equal(c.shouldLoadLeaderboard(false, now - 20 * 60 * 1000, now), false);
});

test('shouldLoadLeaderboard fetches on first activation, with no cached data yet', () => {
  const c = playersDataContext();
  assert.equal(c.shouldLoadLeaderboard(true, undefined, 1_000_000), true);
});

test('shouldLoadLeaderboard does not refetch on reactivation within the 10-minute cache TTL', () => {
  const c = playersDataContext();
  const fetchedAt = 1_000_000;
  const now = fetchedAt + 5 * 60 * 1000; // 5 minutes later
  assert.equal(c.shouldLoadLeaderboard(true, fetchedAt, now), false);
});

test('shouldLoadLeaderboard refetches on reactivation once the cache is older than 10 minutes', () => {
  const c = playersDataContext();
  const fetchedAt = 1_000_000;
  const now = fetchedAt + 11 * 60 * 1000; // 11 minutes later
  assert.equal(c.shouldLoadLeaderboard(true, fetchedAt, now), true);
  // Exactly at the TTL boundary is still fresh (strictly greater-than triggers a reload).
  assert.equal(c.shouldLoadLeaderboard(true, fetchedAt, fetchedAt + 10 * 60 * 1000), false);
});

test('players.css never truncates names and history.css has no leftover ProfilesView search/pagination rules', () => {
  const playersCss = readModule('uiPlayersCss');
  assert.doesNotMatch(playersCss, /text-overflow:\s*ellipsis/);
  const historyCss = readModule('uiHistoryCss');
  assert.doesNotMatch(historyCss, /\.explorer-results/);
  assert.doesNotMatch(historyCss, /\.explorer-pagination/);
});
