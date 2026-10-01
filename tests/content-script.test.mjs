import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { evaluate, deferred, tick, context, players, roster, matchEvent, contentRoomHarness } from './support/helpers.mjs';

test('duplicate content scans coalesce while acknowledgement is pending; failed sends can retry',async()=>{
  const gate=deferred();let sends=0;
  const c=context({sendPrematchRoster:()=>{sends++;return gate.promise;}});evaluate(c,'content');
  const a=c.publishRoster(roster(),'synced'),b=c.publishRoster(roster(),'synced');await tick();assert.equal(sends,1);
  gate.resolve();await Promise.all([a,b]);
  let fail=true;c.sendPrematchRoster=async()=>{sends++;if(fail)throw new Error('Connection error');};
  await assert.rejects(c.publishRoster(roster('NEXT'),'synced'),/Connection error/);
  fail=false;await c.publishRoster(roster('NEXT'),'synced');assert.equal(sends,3);
});

test('DOM draft updates preserve phase/turn within a match, never across matches',async()=>{
  const sent=[];const c=context({sendDraftSnapshot:async s=>sent.push(s),window:{location:{href:'https://drafter.uma.guide/spectate/ROOM01'}},extractMatchCodeFromUrl:()=> 'ROOM01'});
  evaluate(c,'content');
  const teams={team1:{id:'team1',maps:[],umas:[]},team2:{id:'team2',maps:[],umas:[]}};
  await c.publishDraftSnapshot({matchCode:'ROOM01',teams,phase:'pick',currentTeam:'team1',source:'synced-draft-state'});
  teams.team1.umas.push({kind:'pick',name:'Uma'});
  await c.publishDraftSnapshot({matchCode:'ROOM01',teams,source:'draft-dom'});
  assert.equal(sent.at(-1).phase,'pick');assert.equal(sent.at(-1).currentTeam,'team1');
  await c.publishDraftSnapshot({matchCode:'NEXT',teams,source:'draft-dom'});
  assert.equal(sent.at(-1).phase,undefined);
});

test('forced reconnect replays rich synced roster instead of replacing it with partial DOM data',async()=>{
  const sent=[];const c=context({sendPrematchRoster:async r=>sent.push(r)});evaluate(c,'content');
  await c.publishRoster(roster(),'synced');
  await c.publishRoster(roster('ROOM01',1),'dom',{force:true});
  assert.equal(sent.length,2);assert.equal(sent.at(-1).players.length,5);
});

test('same-room departures and empty rosters remain authoritative; console context is explicit',async()=>{
  const c=context({sendPrematchRoster:async r=>sent.push(r)});const sent=[];
  evaluate(c,'syncPayload');evaluate(c,'content');
  const identified=c.selectRoomSyncedState({roomCode:'M95Z2Z',players:players(2)},'M95Z2Z');
  assert.equal(identified.syncedDraftState_multiplayer.players.length,2);
  assert(c.selectRoomSyncedState({syncedDraftState_multiplayer:{participants:players()}},'M95Z2Z',true));
  assert.equal(c.selectRoomSyncedState({syncedDraftState_multiplayer:{participants:players()}},'M95Z2Z',false),null);
  await c.publishRoster(roster('M95Z2Z',10),'synced');
  await c.publishRoster(roster('M95Z2Z',2),'synced');
  await c.publishRoster({matchCode:'M95Z2Z',players:[]},'synced');
  assert.equal(sent.length,3);assert.equal(sent.at(-1).players.length,0);
});

test('content keeps ten players when a later unscoped two-player payload arrives',async()=>{
  const sent=[];const c=context({cleanTeamName:x=>x,document:{},extractRoomCodeFromRoomDom:()=> 'M95Z2Z',
    extractDraftSnapshotFromSyncedDraftState:()=>null,sendPrematchRoster:async r=>sent.push(r)});
  evaluate(c,'syncPayload');evaluate(c,'playerExtraction');evaluate(c,'content');
  const event=(players,roomCode)=>({type:'umalytics:synced-draft-state',hookVersion:4,source:'websocket',payload:{syncedDraftState_multiplayer:{roomCode,rankedQueueRoster:players}}});
  await c.handleWindowMessage(event(players(10),'M95Z2Z'),'M95Z2Z');
  await c.handleWindowMessage(event(players(2),undefined),'M95Z2Z');
  assert.equal(sent.length,1);assert.equal(sent[0].players.length,10);
  await c.handleWindowMessage(event(players(2),'OTHER1'),'M95Z2Z');
  assert.equal(sent.length,1);
  // The new spectator URL takes precedence while old DOM labels are still present.
  c.refreshActiveRoomDomMatchCode('NEXT01');
  assert.equal(c.isStaleSyncedRoster({matchCode:'M95Z2Z'}),true);
  assert.equal(c.isStaleSyncedRoster({matchCode:'NEXT01'}),false);
});

test('room events arriving before DOM identity are replayed only for the matching room',async()=>{
  const h=contentRoomHarness();await h.send(matchEvent({version:4}));
  await h.send(matchEvent({version:2,members:players(2)})); // Older buffered snapshot cannot win.
  await h.send(matchEvent({room:'OTHER1',version:9,members:players(2)}));
  assert.equal(h.sent.length,0);
  h.show('M95Z2Z',roster('M95Z2Z',10));await h.c.publishRoomDomRoster();
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].players.length,10);assert.equal(h.sent[0].observationSource,'room-events');
});

test('overlapping snapshot/assignment acknowledgements cannot resurrect an older roster',async()=>{
  const gate=deferred();const h=contentRoomHarness({delayDraft:gate});h.show('M95Z2Z',roster('M95Z2Z',10));
  const first=h.send(matchEvent());await tick();
  const second=h.send({type:'participant.uma-assignments.snapshot',matchId:'M95Z2Z',team:'team2',revision:1,roster:players(10).slice(5,7)});
  gate.resolve();await Promise.all([first,second]);
  assert.equal(h.sent.at(-1).teams.team2.players.length,2);
  assert.equal(h.sent.at(-1).teams.team1.players.length,5);
});

test('companion DOM and nickname races cannot erase live room identities; presence departures still apply',async()=>{
  const h=contentRoomHarness();h.show('M95Z2Z',roster('M95Z2Z',10));
  await h.send({type:'room.presence.updated',matchId:'M95Z2Z',participants:players(10)});
  const visible={...roster('M95Z2Z',10),phase:'room-lobby',players:players(10).map((p,i)=>({...p,discordId:'room-dom:'+i,userId:'room-dom:'+i,displayName:'Nickname '+i,profileLookupUnavailable:true}))};
  h.show('M95Z2Z',visible);await h.c.publishRoomDomRoster();
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].players.length,10);
  await h.send({type:'room.presence.updated',matchId:'M95Z2Z',participants:players(2)});
  assert.equal(h.sent.at(-1).players.length,2);
  h.show('NEXT01',{...visible,matchCode:'NEXT01'});await h.c.publishRoomDomRoster();
  assert.equal(h.sent.at(-1).matchCode,'NEXT01');assert(h.sent.at(-1).players.every(p=>p.profileLookupUnavailable));
});

test('room identity appearing after startup requests captured events once per room',()=>{
  const h=contentRoomHarness();const requests=[];h.c.window.postMessage=m=>requests.push(m);
  h.c.refreshActiveRoomDomMatchCode();assert.equal(requests.length,0);
  h.show('M95Z2Z',roster());h.c.refreshActiveRoomDomMatchCode();h.c.refreshActiveRoomDomMatchCode();
  assert.equal(requests.length,1);assert.equal(requests[0].type,'umalytics:request-room-events');
  h.show('NEXT01',roster('NEXT01'));h.c.refreshActiveRoomDomMatchCode();assert.equal(requests.length,2);
});

test('idle host draft keeps ten members when lobby header vanishes and later sync arrives',async()=>{
  const h=contentRoomHarness();h.show('284QNV',roster('284QNV',10));
  const sync=()=>h.c.handleWindowMessage({type:'umalytics:synced-draft-state',source:'console',hookVersion:4,payload:{syncedDraftState_phase:'uma-veto',syncedDraftState_multiplayer:{roomCode:'284QNV',rankedQueueRoster:players(10)}}});
  await sync();assert.equal(h.sent.at(-1).players.length,10);
  h.show(undefined,null);
  for(let scan=0;scan<10;scan++) {await h.c.publishRoomDomRoster();await sync();}
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].matchCode,'284QNV');
  assert.equal(h.c.isStaleSyncedRoster(roster('OTHER1')),true);
  await h.c.publishRoomDomRoster({force:true});assert.equal(h.sent.at(-1).players.length,10);
  h.c.window.location.href='https://drafter.uma.guide/';h.c.refreshActiveRoomDomMatchCode();
  assert.equal(vm.runInContext('activeRoomDomMatchCode',h.c),undefined);
});
