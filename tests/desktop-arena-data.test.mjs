import test from 'node:test';
import assert from 'node:assert/strict';
import { roomHarness } from './support/helpers.mjs';
import { livePickEvent } from './fixtures/live-pick-history.mjs';
import { restoreRecentMatches, rememberMatch } from '../apps/desktop/src/recentMatches.ts';

test('live recorded-shape action history survives repeated sanitization with only presentation fields', () => {
  const { c } = roomHarness();
  const decoded = c.decodeRoomEvent('42' + JSON.stringify(['server:event', livePickEvent]));
  const history = JSON.parse(JSON.stringify(decoded.state.draftActionHistory));
  assert.deepEqual(history.map(a => [a.kind, a.team, a.umaId, a.order]), [
    ['ban', 'team1', '100401', 2], ['pick', 'team2', '100201', 3], ['pick', 'team1', '100101', 4], ['pick', 'team2', '100301', 5], ['veto', 'team2', '100301', 6]
  ]);
  for (const entry of history) assert.deepEqual(Object.keys(entry).sort(), ['imageUrl','kind','name','order','team','umaId']);
  assert(!/actor-secret|discord-secret|Player secret|privateField|player name/.test(JSON.stringify(history)));
  assert.deepEqual(JSON.parse(JSON.stringify(c.decodeRoomEvent(decoded).state.draftActionHistory)), history);
  for (const entry of [{ action: 'chat', actorTeam: 'team1', uma: { id: '100101' } }, { action: { toString: 'untrusted' }, actorTeam: 'team1', uma: { id: '100101' } }, { action: 'uma-pick', actorTeam: 'staff', uma: { id: '100101' } }, { action: 'uma-pick', actorTeam: 'team1', uma: { id: 'discord-secret' } }]) {
    assert.equal(c.decodeRoomEvent({ ...livePickEvent, state: { ...livePickEvent.state, draftActionHistory: [entry] } }).state.draftActionHistory.length, 0);
  }
});

test('recent matches are capped, deduplicated display labels with no statistics or identity fields', () => {
  let recent = [];
  for (let i = 0; i < 30; i++) recent = rememberMatch(recent, { code: `ABC${String(i).padStart(3,'0')}`, label: `Teams ${i}`, wins: 999, discordId: 'secret' });
  assert.equal(recent.length, 20);
  recent = rememberMatch(recent, { code: 'ABC015', label: 'Reopened' });
  assert.equal(recent[0].label, 'Reopened');
  assert.equal(recent.length, 20);
  assert.deepEqual(Object.keys(recent[0]), ['code', 'label']);
  assert.deepEqual(restoreRecentMatches([{ code: 'INVALID', label: 'no' }, null]), []);
  assert.deepEqual(restoreRecentMatches([]), []);
});
