import test from './support/clock-test.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { roomHarness } from './support/helpers.mjs';

function moduleWithMocks(file, imports) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => imports[name], structuredClone });
  return exports;
}
function feed() {
  class RoomEventState {
    apply(event, code) { this.matchCode = code; this.draft = event.draft; this.roster = event.roster; return { reason: 'match-snapshot' }; }
  }
  return moduleWithMocks('../apps/desktop/src/feed.ts', { '@umalytics/core/room/roomEvents': { RoomEventState, decodeRoomEvent: roomHarness().c.decodeRoomEvent }, '@umalytics/core/umas/umaPortraits': { normalizeUmaOutfitId: id => id } });
}
const draft = { teams: {
  team1: { umas: [{ kind: 'pick', team: 'team1', umaId: '100101', name: 'First', order: 1 }] },
  team2: { umas: [{ kind: 'veto', team: 'team2', umaId: '100201', name: 'Second', order: 1 }] }
} };
test('desktop keeps a presentation snapshot after the native left/disconnected sequence; active state clears', () => {
  const { DesktopRoom } = feed(); const room = new DesktopRoom();
  room.apply({ v: 1, roomCode: 'ABC123', event: { draft, roster: { players: [1] } } });
  const before = room.state;
  room.apply({ v: 1, type: 'left' });
  assert.equal(room.state.matchCode, undefined);
  assert.equal(room.lastState, before);
  assert.equal(room.lastState.draft, draft);
  assert.deepEqual(room.lastState.roster.players, [1]);
  room.apply({ v: 1, roomCode: 'NEW123', event: { draft: undefined } });
  assert.equal(room.state.matchCode, 'NEW123');
  assert.equal(room.state.draft, undefined);
});
test('pick strip never infers global order from per-team order numbers', () => {
  const { snapshotPickOrder } = feed();
  assert.equal(snapshotPickOrder({}, draft), undefined);
  const first = { action: 'uma-pick', actorTeam: 'team1', uma: { id: '100101' } };
  const second = { action: 'uma-pick', actorTeam: 'team2', uma: { id: '100201' } };
  const read = history => snapshotPickOrder({ type: 'match.snapshot', matchId: 'ABC123', version: 1, state: { phase: 'uma-pick', team1: {}, team2: {}, draftActionHistory: history } }, draft);
  assert.deepEqual(Array.from(read([second, first])), [draft.teams.team2.umas[0], draft.teams.team1.umas[0]]);
  assert.equal(read([first]), undefined);
  assert.equal(read([first, first]), undefined);
  assert.equal(read([first, { ...second, actorTeam: 'team1' }]), undefined);
});
test('copy diagnostics excludes all source identifiers and accepts only known states and numeric counts', () => {
  const { feedDiagnostics } = feed();
  const diagnostic = feedDiagnostics({ state: 'port-in-use', accepted: 12, rejected: 1, discordId: '123456789012345678', token: 'secret', roomCode: 'PRIVATE' });
  assert.deepEqual(JSON.parse(diagnostic), { app: 'UmaLytics', listener: '127.0.0.1:38917', state: 'port-in-use', accepted: 12, rejected: 1 });
  assert(!/secret|PRIVATE|123456789012345678/.test(diagnostic));
  assert.equal(JSON.parse(feedDiagnostics({ state: 'secret', accepted: 'secret', rejected: -1 })).state, 'starting');
});
test('retired page migrates to Lobby and compact threshold defaults to 600 and persists', async () => {
  let saved = { page: 'Skills by map', compactThreshold: 760, fullSize: { width: 640, height: 700 } };
  const store = { get: async () => saved, set: async (_, value) => { saved = value; }, save: async () => {} };
  const p = moduleWithMocks('../apps/desktop/src/preferences.ts', { '@tauri-apps/plugin-store': { load: async () => store } });
  await p.loadPreferences();
  assert.equal(p.preferences.page, 'Lobby');
  assert.equal(p.preferences.compactThreshold, 760);
  await p.savePreferences({ compactThreshold: 600 });
  assert.equal(saved.compactThreshold, 600);
  saved = { compactThreshold: -1 };
  await p.loadPreferences();
  assert.equal(p.preferences.compactThreshold, 600);
  assert(!p.pages.includes('Skills by map'));
});
