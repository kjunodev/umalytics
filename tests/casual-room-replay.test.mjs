import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadFunction, loadModule, parseTsxModule } from './support/harness.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/casual-room-replay.json', import.meta.url)));
const ROOM = fixture.room;

function context(globals = {}) {
  return vm.createContext({ console, URL, URLSearchParams, AbortController, DOMException, Headers, setTimeout, clearTimeout,
    cleanTeamName: x => x, getUmaDisplayName: (id, name) => name ?? id, normalizeUmaOutfitId: x => x, ...globals });
}
function roomHarness() {
  const c = context();
  for (const name of ['matchDetection', 'syncPayload', 'playerExtraction', 'roomEvents', 'rosterDisplay']) loadModule(c, name);
  return { c, state: vm.runInContext('new RoomEventState()', c) };
}

function snapshot(version, { phase = 'complete', ranked } = {}) {
  const team = () => ({ pickedUmas: [], bannedUmas: [], preBannedUmas: [], pickedMaps: [], bannedMaps: [] });
  return { type: 'match.snapshot', matchId: ROOM, version, state: { phase, currentTeam: 'team1', team1: team(), team2: team(),
    multiplayer: { team1Name: 'Fixture Blue', team2Name: 'Fixture Red', ...(ranked ? { rankedQueueRoster: ranked } : {}) } } };
}
function timelineEvent(step) {
  const people = keys => keys.map(key => fixture.participants[key]);
  if (step.kind === 'snapshot') return snapshot(step.version);
  if (step.kind === 'presence') return { type: 'room.presence.updated', matchId: ROOM, participants: people(step.online), chatMessages: ['DO-NOT-COPY'] };
  return { type: 'participant.uma-assignments.snapshot', matchId: ROOM, team: step.team, revision: step.revision,
    roster: people(step.roster), assignments: [{ assignmentToken: 'DO-NOT-COPY' }] };
}
// Replay the events as the page hook sees them: socket.io server-event frames.
const frame = event => '42' + JSON.stringify(['server:event', event]);

function replay() {
  const h = roomHarness();
  const results = fixture.timeline.map(step => {
    const payload = frame(timelineEvent(step));
    const event = h.c.decodeRoomEvent(payload);
    const update = h.state.apply(payload, ROOM);
    return { update, event };
  });
  return { ...h, results };
}
// Arrays built inside the vm context belong to another realm; copy before deepEqual.
const ids = players => Array.from(players, player => player.discordId);
const allIdentifiers = Object.values(fixture.participants).flatMap(p => [p.userId, p.discordId]).filter(Boolean);

test('casual room replay: presence growth after the draft adds every seated player on the right team', () => {
  const { state, results } = replay();
  const reasons = results.map(r => r.update.reason);
  assert(reasons.includes('old-assignment-revision'));
  assert(reasons.includes('old-version'));
  assert(reasons.includes('empty-assignment-without-membership'));
  assert.equal(state.draft.phase, 'complete');
  assert.deepEqual(ids(state.roster.teams.team1.players), fixture.expected.team1);
  assert.deepEqual(ids(state.roster.teams.team2.players), fixture.expected.team2);
  assert.equal(state.roster.players.length, 6);
  assert.equal(state.roster.teams.team1.name, 'Fixture Blue');
});

test('casual room replay: spectators and players who left the slots are never added', () => {
  const { state } = replay();
  for (const id of fixture.expected.excluded) assert(!ids(state.roster.players).includes(id), id);
});

test('casual room replay: a later presence team cannot reassign an existing member, and an offline member stays', () => {
  const { results } = replay();
  const afterMove = results[11].update.roster;
  assert.equal(afterMove.players.find(p => p.discordId === '100000000000000201').team, 'team1');
  assert(ids(afterMove.players).includes(fixture.participants.guest.userId), 'presence never removes members');
});

test('casual room replay: no raw internal ID is ever shown as a player name', () => {
  const { c, state, results } = replay();
  for (const { update } of results) {
    for (const player of update.roster?.players ?? []) {
      assert(!allIdentifiers.includes(player.displayName), player.displayName);
      assert.equal(c.isRawPlayerIdentifier(player.displayName), false);
    }
  }
  for (const [id, name] of Object.entries(fixture.expected.names)) {
    assert.equal(state.roster.players.find(p => p.discordId === id).displayName, name);
  }
  const display = c.normalizeRosterForDisplay(state.roster);
  assert.deepEqual(Array.from(display.players, p => p.displayName).sort(), Object.values(fixture.expected.names).sort());
});

test('a stored roster carrying a raw ID as a name is displayed as Unknown player', () => {
  const { c } = roomHarness();
  const uuid = fixture.participants.guest.userId;
  const stored = { matchCode: ROOM, players: [
    { userId: uuid, discordId: uuid, displayName: uuid, team: 'team2', partyId: null, partyRatingBonus: 0 },
    { userId: 'x', discordId: '100000000000000204', displayName: '100000000000000204', team: 'team1', partyId: null, partyRatingBonus: 0 },
    { userId: 'y', discordId: '100000000000000205', displayName: 'Fixture Player E', team: 'team1', partyId: null, partyRatingBonus: 0 }] };
  assert.deepEqual(Array.from(c.normalizeRosterForDisplay(stored).players, p => p.displayName), ['Unknown player', 'Unknown player', 'Fixture Player E']);
  assert.equal(c.normalizePrematchPlayer({ userId: uuid, displayName: uuid, discordUsername: 'fixture_user' }).displayName, 'fixture_user');
  assert.equal(c.normalizePrematchPlayer({ userId: uuid, team: 'team1' }).displayName, 'Unknown player');
});

test('the player without a Discord ID has no profile lookup and makes no stats request', async () => {
  const { state } = replay();
  const guest = state.roster.players.find(p => p.userId === fixture.participants.guest.userId);
  const ui = vm.createContext({});
  loadFunction(ui, parseTsxModule('uiPlayerProfileDisplay'), 'getLookupDiscordId');
  assert.equal(ui.getLookupDiscordId(guest), undefined);
  assert.equal(state.roster.players.filter(p => ui.getLookupDiscordId(p) !== undefined).length, 5);

  const calls = [];
  const api = context({ recordDiagnostic: () => {}, fetch: async (url, init) => {
    calls.push(url.pathname + url.search);
    const body = url.pathname === '/api/seasons' ? [{ id: 'S1', active: true }] : url.pathname === '/api/leaderboard' ? { entries: [] }
      : { summary: { matchesIncluded: 0, totalPointsScored: 0 }, umaEntries: [] };
    return { ok: true, status: 200, headers: new Headers(), json: async () => { init.signal.throwIfAborted(); return body; } };
  } });
  for (const name of ['profileConstants', 'umaReleaseOrder', 'umaPortraits', 'requestQueue']) loadModule(api, name);
  loadModule(api, 'playerProfileApi', { fast: true });
  await api.fetchPlayerProfileSummaries(state.roster.players, { scope: 'allTime' });
  assert(calls.some(path => path.includes('/stats?')));
  assert(!calls.some(path => path.includes(encodeURIComponent(guest.discordId)) || path.includes(guest.userId)), JSON.stringify(calls));
});

test('a newer per-team assignment stays authoritative for the team it covers after presence growth', () => {
  const { state } = replay();
  const p = fixture.participants;
  const update = state.apply(frame(timelineEvent({ kind: 'assignment', team: 'team1', revision: 4, roster: ['captainA', 'playerB'] })), ROOM);
  assert.equal(update.reason, 'team-assignment');
  assert.deepEqual(ids(state.roster.teams.team1.players), [p.captainA.discordId, p.playerB.discordId]);
  assert.deepEqual(ids(state.roster.teams.team2.players), fixture.expected.team2);
});

test('ranked rooms keep rankedQueueRoster authoritative: presence never adds members', () => {
  const { state } = roomHarness();
  const ranked = Array.from({ length: 10 }, (_, i) => ({ userId: `ranked-${i}`, discordId: String(100000000000000300n + BigInt(i)),
    displayName: `Ranked ${i}`, team: i < 5 ? 'team1' : 'team2' }));
  state.apply(snapshot(5, { phase: 'uma-pick', ranked }), ROOM);
  const extra = { ...fixture.participants.captainA, discordId: '100000000000000399', userId: 'ranked-extra' };
  const update = state.apply({ type: 'room.presence.updated', matchId: ROOM, participants: [...ranked.slice(0, 2), extra] }, ROOM);
  assert.equal(update.roster.players.length, 10);
  assert(!ids(update.roster.players).includes('100000000000000399'));
});

test('room-event diagnostics summarize sources and missing fields without names, IDs, tokens or chat', () => {
  const { c, results } = replay();
  const recorder = context({ browser: { storage: { local: { get: async () => ({}), set: async () => {} } } } });
  loadModule(recorder, 'diagnosticRecorder');
  const trace = results.map(({ update, event }, index) => ({ ...recorder.sanitizeDiagnostic({
    kind: 'room', reason: update.reason, room: ROOM, ...c.summarizeRoomEvent(event), version: 49, phase: 'complete',
    team1: update.roster?.players.filter(p => p.team === 'team1').length,
    team2: update.roster?.players.filter(p => p.team === 'team2').length,
    displayName: 'Fixture Captain A', discordId: '100000000000000201', token: 'DO-NOT-COPY' }), at: Date.UTC(2026, 8, 30, 12, 0, index) }));

  const firstPresence = trace[1];
  assert.equal(firstPresence.event, 'presence');
  assert.equal(firstPresence.participants, 1);
  assert.equal(firstPresence.missingDiscordId, 1);
  assert.equal(firstPresence.missingTeam, 0);
  assert.equal(firstPresence.missingDisplayName, 0);
  assert.equal(firstPresence.rankedRoster, undefined);
  const assignment = trace[2];
  assert.equal(assignment.event, 'assignment');
  assert.equal(assignment.revision, 7);
  assert.equal(assignment.assignmentRoster, 1);
  assert.equal(trace[3].reason, 'empty-assignment-without-membership');
  const last = trace.at(-1);
  assert.equal(last.participants, 8);
  assert.equal(last.missingDiscordId, 1);
  assert.equal(last.missingTeam, 1, 'the spectator is seated; only the player who left the slots has no team');
  assert.equal(last.missingDisplayName, 2);
  assert.equal(last.spectators, 1);
  assert.equal(last.team1, 3);
  assert.equal(last.team2, 3);

  const ui = context({ ROOM_EVENT_SUMMARY_LIMIT: 30 });
  loadFunction(ui, parseTsxModule('uiScoutData'), 'formatRoomEventSummary');
  const text = ui.formatRoomEventSummary([...trace, { kind: 'request', endpoint: 'stats', status: 200 }], 5);
  const lines = text.split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines.at(-1), /presence \| presence-update \| phase complete \| v49 \| team1 3 team2 3 \| sources: participants 8 \| missing: discordId 1, team 1, displayName 2 \| spectators 1/);
  for (const secret of [...allIdentifiers, ROOM, 'Fixture', 'fixture_user', 'DO-NOT-COPY']) assert(!text.includes(secret), secret);
  for (const secret of [...allIdentifiers, 'Fixture', 'DO-NOT-COPY']) assert(!JSON.stringify(trace).includes(secret), secret);
  assert.equal(ui.formatRoomEventSummary([]), 'none');
});
