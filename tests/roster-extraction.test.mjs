import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, context, players } from './support/helpers.mjs';

test('team normalization resolves final/initial teams and drops spectators without slots',()=>{
  const c=context({cleanTeamName:x=>x});evaluate(c,'syncPayload');evaluate(c,'playerExtraction');
  evaluate(c,'rosterDisplay');
  const fixture={syncedDraftState_multiplayer:{roomId:'ROOM01',participants:players().map((p,i)=>i<2?{...p,team:undefined,finalTeam:'team1'}:p)}};
  const r=c.normalizeRosterForDisplay(c.extractPrematchRosterFromSyncedDraftState(fixture));
  assert.equal(r.players.length,5);assert.equal(r.teams.team1.players.length,2);assert.equal(r.teams.team2.players.length,3);
  fixture.syncedDraftState_multiplayer.participants[0].finalTeam=undefined;
  const partial=c.normalizeRosterForDisplay(c.extractPrematchRosterFromSyncedDraftState(fixture));
  assert.equal(partial.players.length,4);assert.equal(partial.players.filter(p=>p.team===undefined).length,0);
  assert.equal(c.getTeamGroups(partial).flatMap(t=>t.players).length,4);
});

test('explicit spectator roles and cleared current slots override historical teams',()=>{
  const c=context({cleanTeamName:x=>x});evaluate(c,'syncPayload');evaluate(c,'playerExtraction');
  const fixture=players(5);
  fixture[0]={...fixture[0],role:'Spectator'};
  fixture[1]={...fixture[1],roomRole:'spectator',role:'captain'};
  fixture[2]={...fixture[2],team:null,initialTeam:'team1',finalTeam:'team2'};
  const result=c.normalizePrematchRosterFromPlayers(fixture,'ROOM01');
  assert.equal(result.players.length,2);
  assert(result.players.every(p=>['Player 3','Player 4'].includes(p.displayName)));
});

test('unscoped or foreign socket/storage rosters cannot replace the M95Z2Z team',()=>{
  const c=context();evaluate(c,'syncPayload');
  const small={rankedQueueRoster:players(2).map(p=>({...p,team:'team2'}))};
  assert.equal(c.selectRoomSyncedState(small,'M95Z2Z'),null);
  assert.equal(c.selectRoomSyncedState({roomCode:'OTHER1',data:small},'M95Z2Z'),null);
  const right=c.selectRoomSyncedState({roomCode:'M95Z2Z',data:{syncedDraftState_multiplayer:{rankedQueueRoster:players(10)}}},'M95Z2Z');
  assert.equal(right.syncedDraftState_multiplayer.roomCode,'M95Z2Z');
  assert.equal(right.syncedDraftState_multiplayer.rankedQueueRoster.length,10);
  const batch=c.selectRoomSyncedState([{roomCode:'OTHER1',data:small},{roomCode:'M95Z2Z',data:{rankedQueueRoster:players(10)}}],'M95Z2Z');
  assert.equal(batch.syncedDraftState_multiplayer.rankedQueueRoster.length,10);
});

test('synced payload traversal is bounded and rejects cyclic/foreign nested data',()=>{
  const c=context();evaluate(c,'syncPayload');const cycle={};cycle.self=cycle;
  assert.equal(c.selectRoomSyncedState(cycle,'M95Z2Z'),null);
  assert.equal(c.selectRoomSyncedState({roomCode:'OTHER1',data:{players:players()}},'M95Z2Z',true),null);
  const data={roomCode:'M95Z2Z',roomId:'cec650b6-a357-4d35-9133-7b6db44ae46f'};
  assert.equal(c.readPayloadRoomCode(data),'M95Z2Z');
});
