import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { roomHarness } from './support/helpers.mjs';
import { extraFieldNames, feedFieldsEvent, hiddenValue, season3KnownKeysEvent } from './fixtures/room-feed-fields.mjs';

test('decoder reports exactly the new field names and leaves the decoded event unchanged', () => {
  const { c } = roomHarness();
  const fields = vm.runInContext('new UnrecognisedFeedFields()', c);
  c.decodeRoomEvent(feedFieldsEvent(false), fields);
  assert.equal(c.formatUnrecognisedFeedFields(fields.snapshot()), 'Unrecognised feed fields\nnone');

  const event = feedFieldsEvent();
  assert.deepEqual(c.decodeRoomEvent(event, fields), c.decodeRoomEvent(event));
  assert.deepEqual(Array.from(fields.snapshot(), ({ name }) => name), extraFieldNames);
  assert(fields.snapshot().every(field => field.count === 1 && field.firstEventType === 'match.snapshot'));
  const text = c.formatUnrecognisedFeedFields(fields.snapshot());
  assert(!text.includes(hiddenValue));
  assert(!text.includes('hiddenKey'));
  assert(!text.includes(event.matchId));

  event.state.participantUmaAssignments[1].futureAssignment = hiddenValue;
  c.decodeRoomEvent(event, fields);
  assert.equal(fields.snapshot().find(field => field.name === 'futureAssignment').count, 3);
});

test('tally filters identity-shaped names, truncates and keeps counting retained names at the cap', () => {
  const { c } = roomHarness();
  const fields = vm.runInContext('new UnrecognisedFeedFields()', c);
  const unknownType = 'room.future.updated';
  const event = feedFieldsEvent(false);
  const blocked = ['123456789012345678', '29b5fc33-ef5b-44b6-8ad9-a88b151482ee',
    '29b5fc33ef5b44b68ad9a88b151482ee', 'AB3-D9E', 'ab3d9e', 'Fixture Racer', 'key/segment', 'key\n'];
  for (const name of blocked) {
    event.state[name] = hiddenValue;
    assert.equal(c.decodeRoomEvent(['server:event', { type: name }], fields), null);
  }
  assert.equal(fields.snapshot().length, 0);
  assert.equal(c.decodeRoomEvent(['room:chat', { type: unknownType }], fields), null);
  assert.equal(fields.snapshot().length, 0);
  assert.equal(c.decodeRoomEvent('42' + JSON.stringify(['server:event', { type: unknownType, text: hiddenValue }]), fields), null);
  const longName = 'future_'.repeat(12);
  Object.assign(event.state, { [unknownType]: hiddenValue, [longName]: hiddenValue, [longName + 'Other']: hiddenValue });
  for (let i = 0; i < 60; i++) event.state['future.option-' + i] = hiddenValue;
  event.state.rules[unknownType] = hiddenValue;
  c.decodeRoomEvent(event, fields);

  const entries = fields.snapshot();
  assert.equal(entries.length, 50);
  assert.equal(entries[0].name, unknownType);
  assert.equal(entries[0].firstEventType, unknownType);
  assert.equal(entries[0].count, 3);
  assert.equal(entries[1].name, longName.slice(0, 64));
  assert.equal(entries[1].count, 2);
  assert(entries.every(({ name }) => name.length <= 64 && /^[A-Za-z0-9_.-]+$/.test(name) && !blocked.includes(name)));
  assert(!c.formatUnrecognisedFeedFields(entries).includes(hiddenValue));
});

test('keys already seen in Season 3 ranked and Quickplay snapshots are not reported', () => {
  const { c } = roomHarness();
  const fields = vm.runInContext('new UnrecognisedFeedFields()', c);
  c.decodeRoomEvent(season3KnownKeysEvent(), fields);
  assert.equal(fields.snapshot().length, 0);
});

test('six-character camelCase field names are kept while match-code-shaped names are dropped', () => {
  const { c } = roomHarness();
  const fields = vm.runInContext('new UnrecognisedFeedFields()', c);
  const event = feedFieldsEvent(false);
  Object.assign(event.state, { groups: hiddenValue, seasonId: hiddenValue, '5HQKZG': hiddenValue, REXQAB: hiddenValue, ab3d9e: hiddenValue });
  event.state.multiplayer.status = hiddenValue;
  c.decodeRoomEvent(event, fields);
  assert.deepEqual(Array.from(fields.snapshot(), ({ name }) => name).sort(), ['groups', 'seasonId', 'status']);
});
