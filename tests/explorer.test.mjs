import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadModule } from './support/harness.mjs';
const load = loadModule;

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/completed-match.json', import.meta.url)));
function harness(globals = {}) {
  const context = vm.createContext({ URL, URLSearchParams, Error, console, AbortController, setTimeout, clearTimeout,
    getUmaDisplayName: (id, name) => name, getUmaPortraitUrl: id => `portrait:${id}`, normalizeUmaOutfitId: id => id,
    ...globals });
  load(context, 'matchDetection'); load(context, 'explorerData');
  return context;
}

test('history input accepts code, hyphen, and exact match URL; rejects foreign URLs and paths', () => {
  const h = harness();
  for (const value of ['fx1a2b', ' FX1-A2B ', 'https://drafter.uma.guide/matches/FX1A2B?view=1']) assert.equal(h.parseHistoryInput(value), 'FX1A2B');
  for (const value of ['', '../FX1A2B', 'https://evil.example/matches/FX1A2B', 'https://drafter.uma.guide/host', 'https://x@drafter.uma.guide/matches/FX1A2B']) assert.throws(() => h.parseHistoryInput(value));
});

test('profile input preserves stable IDs and treats nicknames as search terms', () => {
  const h = harness();
  assert.equal(h.parsePlayerInput('https://drafter.uma.guide/players/100000000000000099').id, '100000000000000099');
  assert.equal(h.parsePlayerInput('Fixture Query').query, 'Fixture Query');
  for (const value of ['1', 'https://drafter.uma.guide/players/me', 'https://evil.example/players/100000000000000099']) assert.throws(() => h.parsePlayerInput(value));
});

test('recorded completed match maps final picks, vetoes, maps, stable IDs and teams without pool leakage', () => {
  const result = harness().parseHistoricalMatch(fixture, 'FX1A2B');
  assert.equal(result.roster.players.length, 10);
  assert.equal(result.roster.teams.team1.players.length, 5);
  assert.equal(result.roster.teams.team2.players.length, 5);
  assert.equal(result.draft.source, 'match-history');
  assert.equal(result.draft.teams.team1.name, 'Fixture Team A');
  assert.equal(result.draft.teams.team2.name, 'Fixture Team B');
  for (const team of Object.values(result.draft.teams)) {
    assert.equal(team.umas.filter(item => item.kind === 'pick').length, 6);
    assert.equal(team.umas.filter(item => item.kind === 'ban').length, 2);
    assert.equal(team.umas.filter(item => item.kind === 'veto').length, 1);
    assert.equal(team.maps.length, 4);
    assert.equal(team.maps.filter(item => item.status === 'vetoed').length, 1);
  }
  assert(!result.draft.teams.team1.umas.some(item => item.kind === 'pick' && item.umaId === '102602'));
  assert(result.draft.teams.team1.umas.some(item => item.kind === 'veto' && item.umaId === '102602'));
  assert.equal(result.draft.teams.team1.maps.find(item => item.status === 'vetoed').order, 7);
  assert.equal(result.draft.teams.team2.maps.find(item => item.status === 'vetoed').order, 6);
  assert.match(result.draft.tiebreakerMap.name, /Hanshin/);
  assert.equal(result.draft.currentTeam, undefined);
  assert(result.roster.players.every(player => player.ratingSnapshot === undefined));
});

test('missing, wrong, or incomplete matches fail clearly; missing player IDs never infer identity', () => {
  const h = harness();
  assert.throws(() => h.parseHistoricalMatch({}, 'FX1A2B'), /different match/);
  assert.throws(() => h.parseHistoricalMatch({ id: 'FX1A2B', report: {} }, 'FX1A2B'), /saved draft/);
  const copy = structuredClone(fixture); copy.status = 'active'; copy.report.draftSnapshot.phase = 'uma-pick';
  assert.throws(() => h.parseHistoricalMatch(copy, 'FX1A2B'), /not complete/);
  copy.status = 'completed'; copy.report.participants = [{ displayName: 'Companion', team: 'team1' }];
  const result = h.parseHistoricalMatch(copy, 'FX1A2B');
  assert.equal(result.roster.players.length, 0); assert(result.warnings.length);
});

test('directory search keeps duplicate names as separate IDs, removes duplicate IDs and paginates', () => {
  const players = Array.from({ length: 12 }, (_, i) => ({ discordId: String(100000000000000000n + BigInt(i)), discordUsername: 'Same nickname' }));
  const data = { players: [...players, players[0], { discordUsername: 'Missing ID' }] };
  const result = harness().parsePlayerSearch(data, 2);
  assert.equal(result.total, 12); assert.equal(result.players.length, 2); assert.equal(result.page, 2);
  assert.throws(() => harness().parsePlayerSearch({ results: [] }), /unsupported/);
});

test('unsupported saved selection arrays fail explicitly instead of displaying an empty completed draft', () => {
  const h = harness();
  for (const field of ['pickedMaps', 'bannedMaps', 'pickedUmas', 'preBannedUmas', 'bannedUmas']) {
    for (const invalid of [undefined, {}, [null], [{ id: '100101' }]]) {
      const copy = structuredClone(fixture); copy.report.draftSnapshot.team1[field] = invalid;
      assert.throws(() => h.parseHistoricalMatch(copy, 'FX1A2B'), /unsupported format/);
    }
  }
  const copy = structuredClone(fixture);
  copy.report.draftSnapshot.team1.preBannedUmas = [];
  assert.equal(h.parseHistoricalMatch(copy, 'FX1A2B').draft.teams.team1.umas.filter(item => item.kind === 'ban').length, 0);
});

function service(globals = {}) {
  const calls = [];
  const h = harness({ BEST_UMA_SCORE_VERSION: 17, RECENT_HISTORY_VERSION: 6, PROFILE_CACHE_TTL_MS: 900000,
    getCachedPlayerProfiles: async () => ({}), rememberCachedPlayerProfiles: async () => {},
    getApiCooldown: () => undefined, fetchJson: async path => { calls.push(path); return fixture; },
    ...globals });
  load(h, 'explorerTypes'); load(h, 'explorerService');
  return { h, calls };
}

test('lookup validates request size, IDs, page, and scope before fetching', () => {
  const { h } = service();
  for (const bad of [{ kind:'profiles', scope:'allTime', players:[{discordId:'../admin'}] }, { kind:'profiles',scope:'both',players:[] }, {kind:'search',input:'Fixture Query',page:0}, {kind:'match',input:'x'.repeat(301)}]) assert.throws(() => h.validateExplorerRequest(bad));
  assert.equal(h.validateExplorerRequest({kind:'profiles',scope:'allTime',players:[{discordId:'100000000000000099',profileUrl:'https://evil.example'}]}).players[0].profileUrl, 'https://drafter.uma.guide/players/100000000000000099');
});

test('history and exact ID lookup do not invoke live enrichment or write live storage', async () => {
  const { h, calls } = service(); const signal = new AbortController().signal;
  const match = await h.executeExplorerRequest({kind:'match',input:'FX1A2B'}, signal, () => {});
  assert.equal(match.matchCode, 'FX1A2B');
  const player = await h.executeExplorerRequest({kind:'search',input:'100000000000000099',page:1}, signal, () => {});
  assert.equal(player.players.length, 1); assert.deepEqual(calls, ['/api/matches/FX1A2B']);
});

test('fresh scope-specific archive hits avoid profile requests; partial/wrong scope refetch', async () => {
  const id = '100000000000000099'; let fetched = 0;
  const cached = {discordId:id,statsScope:'allTime',fetchedAt:Date.now(),bestUmaScoreVersion:17,recentHistoryVersion:6};
  const { h } = service({getCachedPlayerProfiles:async()=>({[id]:cached}), fetchPlayerProfileSummaries:async players=>{fetched++;return {[id]:cached};}});
  await h.executeExplorerRequest({kind:'profiles',scope:'allTime',players:[{discordId:id}]},new AbortController().signal,()=>{});
  assert.equal(fetched,0);
  await h.executeExplorerRequest({kind:'profiles',scope:'currentSeason',players:[{discordId:id}]},new AbortController().signal,()=>{});
  assert.equal(fetched,1);
  cached.isPartial=true;
  await h.executeExplorerRequest({kind:'profiles',scope:'allTime',players:[{discordId:id}]},new AbortController().signal,()=>{});
  assert.equal(fetched,2);
});

test('cancelled lookup does not publish late profiles or save the result', async () => {
  const controller = new AbortController(); let published = 0, saved = 0;
  const { h } = service({fetchPlayerProfileSummaries:async(_, options)=>{controller.abort(); options.onProgress({discordId:'100000000000000099'});return {};},rememberCachedPlayerProfiles:async()=>{saved++;}});
  await assert.rejects(h.executeExplorerRequest({kind:'profiles',scope:'allTime',players:[{discordId:'100000000000000099'}]},controller.signal,()=>{published++;}));
  assert.equal(published,0); assert.equal(saved,0);
});

test('rate-limit errors preserve a retry timestamp and missing records have an actionable message', () => {
  const until=Date.now()+10000;
  assert.equal(service({getApiCooldown:()=>({until})}).h.explorerError(new Error('429')).retryAt,until);
  assert.match(service().h.explorerError(new Error('Request failed (HTTP 404): path')).message,/No matching record/);
});

test('retry failures retain useful displayed stats, but a confirmed private response removes them', () => {
  const h = harness(); load(h, 'explorerState');
  const old = { discordId: '1', matches: 20, fetchedAt: 100, statsPrivate: false };
  const failed = h.mergeExplorerProfiles({ '1': old }, { '1': { discordId: '1', matches: null, error: '429', statsPrivate: false } });
  assert.equal(failed['1'].matches, 20); assert.equal(failed['1'].fetchedAt, 100);
  const hidden = h.mergeExplorerProfiles(failed, { '1': { discordId: '1', matches: null, statsPrivate: true } });
  assert.equal(hidden['1'].matches, null); assert.equal(hidden['1'].statsPrivate, true);
  const partial = h.mergeExplorerProfiles({ '1': { ...old, isPartial: true } }, { '1': { discordId: '1', matches: null, error: 'Profile timed out', statsPrivate: false } });
  assert.equal(partial['1'].matches, 20); assert.equal(partial['1'].isPartial, false);
  assert.match(partial['1'].error, /timed out/);
  const recovered = h.mergeExplorerProfiles({ '1': { discordId: '1', matches: null, isPartial: true } }, { '1': { ...old, error: 'Profile identity failed' } });
  assert.equal(recovered['1'].matches, 20);
  const updated = h.mergeExplorerProfiles({ '1': old }, { '1': { ...old, matches: 21, error: 'Profile identity failed' } });
  assert.equal(updated['1'].matches, 21);
});
