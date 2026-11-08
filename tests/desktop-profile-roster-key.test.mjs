import test from 'node:test';
import assert from 'node:assert/strict';
import { profileRosterKey } from '../apps/desktop/src/profileRosterKey.ts';

const players = [
  { discordId: '100000000000000001', displayName: 'First', team: 'team1' },
  { discordId: '100000000000000002', displayName: 'Second', team: 'team2' }
];
const key = roster => profileRosterKey('ROOM01', roster);
const original = key({ players });

test('captain, team and display name changes preserve the profile load key', () => {
  for (const patch of [{ isCaptain: true, role: 'captain' }, { team: 'team2' }, { displayName: 'Renamed' }]) {
    assert.equal(key({ players: [{ ...players[0], ...patch }, players[1]] }), original);
  }
});

test('order and duplicate membership preserve the profile load key', () => {
  assert.equal(key({ players: [players[1], players[0], players[0]] }), original);
});

test('joining, leaving and changing rooms restart profile loading', () => {
  assert.notEqual(key({ players: [...players, { discordId: '100000000000000003' }] }), original);
  assert.notEqual(key({ players: players.slice(0, 1) }), original);
  assert.notEqual(profileRosterKey('ROOM02', { players }), original);
});

test('an absent roster and an empty roster have the same membership', () => {
  assert.equal(key(undefined), key({ players: [] }));
  assert.equal(profileRosterKey(undefined, undefined), '[null,[]]');
});
