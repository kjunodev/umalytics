import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { replayEnvelopes } from '../apps/desktop/scripts/replay-fixture.mjs';
import { apiHarness } from './support/helpers.mjs';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@umalytics/core/')) {
      return nextResolve(new URL(`../packages/core/src/${specifier.slice('@umalytics/core/'.length)}.ts`, import.meta.url).href, context);
    }
    if (context.parentURL?.includes('/packages/core/') && specifier.startsWith('.') && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});
const { DesktopRoom } = await import('../apps/desktop/src/feed.ts');
hooks.deregister();
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/casual-room-replay.json', import.meta.url)));

test('desktop replay envelopes drive the real core roster and left clears all room state', () => {
  const room = new DesktopRoom();
  const messages = replayEnvelopes(fixture);
  messages.slice(0, -1).forEach(message => room.apply(message));
  assert.equal(room.state.matchCode, fixture.room);
  assert.equal(room.state.draft.phase, 'complete');
  for (const team of ['team1', 'team2']) {
    assert.deepEqual(room.state.roster.teams[team].players.map(player => player.discordId), fixture.expected[team]);
  }
  for (const player of room.state.roster.players) assert.equal(player.displayName, fixture.expected.names[player.discordId]);
  for (const id of fixture.expected.excluded) assert(!room.state.roster.players.some(player => player.discordId === id));
  room.apply(messages.at(-1));
  assert.equal(room.state.matchCode, undefined);
  assert.equal(room.state.roster, undefined);
  assert.equal(room.state.draft, undefined);
  assert.equal(room.state.version, -1);
});

test('completed match history cannot enter the realtime replay path', () => {
  const completed = JSON.parse(fs.readFileSync(new URL('./fixtures/completed-match.json', import.meta.url)));
  assert.throws(() => replayEnvelopes(completed), /history report/);
});

test('core fetch adapter receives cancellation and preserves 429 cooldown handling', async () => {
  const { c } = apiHarness();
  let init;
  c.configureCorePlatform({ fetch: async (url, options) => {
    assert.equal(url.origin, 'https://drafter-api.uma.guide');
    init = options;
    return { ok: false, status: 429, headers: new Headers({ 'retry-after': '2' }), body: null };
  } });
  await assert.rejects(c.fetchJson('/api/desktop-adapter'), /HTTP 429/);
  assert(init.signal instanceof AbortSignal);
  assert.equal(init.cache, 'no-store');
  assert.equal(init.credentials, 'omit');
  assert.equal(c.getApiCooldown().status, 429);
  assert.equal(c.getApiCooldown().startIntervalMs, 2);
  await assert.rejects(c.fetchJson('/api/another'), /API paused after HTTP 429/);
});
