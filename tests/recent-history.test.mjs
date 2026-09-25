import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModuleTS, loadFunction, parseTsxModule } from './support/harness.mjs';

const displaySyntax = parseTsxModule('uiPlayerProfileDisplay');
const teamSyntax = parseTsxModule('uiLobbyTeamSection');
const scoutSyntax = parseTsxModule('uiScoutData');
const entry = { matchId: 'FIX001', reportedAt: '2026-09-18T12:00:00Z', mode: 'ranked', verificationState: 'confirmed', umaId: null, umaName: 'Unknown Uma', isWinner: true, pointsScored: 3, podiums: 1, isMvp: false };

function harness(privateBuild = false) {
  const c = vm.createContext({ __UMALYTICS_PRIVATE_PROFILE_DATA__: privateBuild,
    filterSnapshotForBuild: x => x, filterProfileStatesForDisplay: x => x,
    getLoadingDiscordIdsForDisplay: () => [] });
  for (const name of ['profileConstants', 'profileMerge', 'profileCache', 'explorerState']) loadModuleTS(c, name);
  for (const name of ['getDisplayedProfileStats', 'withDetailHistory']) loadFunction(c, displaySyntax, name);
  loadFunction(c, teamSyntax, 'getCardProfile');
  loadFunction(c, scoutSyntax, 'normalizeProfileSnapshotForDisplay');
  return c;
}

function profile(scope = 'allTime', matches = [entry]) {
  const stats = { matches: matches.length, recentMatches: matches, recentHistoryStatus: 'loaded', recentHistoryVersion: 6 };
  return { discordId: '123456789012345678', displayName: 'Fixture', profileUrl: '', fetchedAt: Date.now(), activeSeasonId: 'S1', statsScope: scope,
    scopeFetchedAt: { [scope]: Date.now() }, bestUmaScoreVersion: 17, recentHistoryVersion: 6, ...stats,
    allTimeStats: scope === 'allTime' ? stats : { recentMatches: [], recentHistoryVersion: 6 },
    currentSeasonStats: scope === 'currentSeason' ? stats : { recentMatches: [], recentHistoryVersion: 6 } };
}

test('public cards discard cached history fields while drawer display permits fetched match rows', () => {
  const c = harness();
  const cached = { ...profile(), recentForm: { matches: 5, wins: 4 }, historyTotal: 25 };
  cached.allTimeStats = { ...cached.allTimeStats, recentForm: cached.recentForm, historyTotal: 25 };
  const card = c.getCardProfile(cached, 'allTime', false);
  assert.equal(card.recentMatches.length, 0);
  assert.equal(card.recentForm, undefined);
  assert.equal(card.historyTotal, undefined);
  const display = c.withDetailHistory(cached, [entry], 21, { wins: 1 });
  assert.equal(display.recentMatches[0].matchId, 'FIX001');
  assert.equal(display.historyTotal, 21);
  assert.equal(display.recentForm, undefined, 'the public UI must not derive stats from displayed history');
  assert.equal(display.matches, cached.matches);
});

test('history based recent form is available only in the private build', () => {
  assert.equal(harness(false).withDetailHistory(profile(), [entry], 1).recentForm, undefined);
  const privateForm = harness(true).withDetailHistory(profile(), [entry], 1).recentForm;
  assert.equal(privateForm.matches, 1);
  assert.equal(privateForm.wins, 1);
});

test('scope changes retain separate history and a new season cannot inherit the old season', () => {
  const c = harness();
  const old = profile('currentSeason');
  const incoming = profile('allTime', [{ ...entry, matchId: 'NEW001' }]);
  const merged = c.mergeProfileScopes(old, incoming);
  assert.equal(c.getDisplayedProfileStats(merged, 'currentSeason').recentMatches[0].matchId, 'FIX001');
  assert.equal(c.getDisplayedProfileStats(merged, 'allTime').recentMatches[0].matchId, 'NEW001');
  const nextSeason = c.mergeProfileScopes(old, { ...incoming, activeSeasonId: 'S2' });
  assert.equal(c.getDisplayedProfileStats(nextSeason, 'currentSeason').recentMatches.length, 0);
});

test('partial history updates preserve loaded rows; completed empty responses clear them', () => {
  const c = harness(true), old = profile();
  for (const status of ['loading', 'unavailable']) {
    const next = profile('allTime', []);
    next.allTimeStats.recentHistoryStatus = status;
    next.isPartial = status === 'loading';
    assert.equal(c.mergeProfileScopes(old, next).allTimeStats.recentMatches.length, 1);
  }
  assert.equal(c.mergeProfileScopes(old, profile('allTime', [])).recentMatches.length, 0);
});

test('privacy denial invalidates cached history in both scopes', () => {
  const c = harness(true), old = profile('currentSeason');
  const denied = profile('allTime', []);
  denied.statsPrivate = true;
  denied.recentHistoryStatus = 'private';
  denied.allTimeStats.recentHistoryStatus = 'private';
  const result = c.mergeProfileScopes(old, denied);
  assert.equal(result.recentMatches.length, 0);
  assert.equal(c.getDisplayedProfileStats(result, 'currentSeason').recentMatches.length, 0);
});
