import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, players, roomHarness, matchEvent, domHarness, realTrainerRow, lobbyFixture } from './support/helpers.mjs';

test('room code normalization supports host display and join/spectate routes',()=>{
  const {c}=roomHarness();
  assert.equal(c.normalizeMatchCode('6XN-84X'),'6XN84X');
  assert.equal(c.extractMatchCodeFromUrl('https://drafter.uma.guide/join/6XN84X'),'6XN84X');
  assert.equal(c.extractMatchCodeFromUrl('https://drafter.uma.guide/host'),undefined);
  assert.equal(c.normalizeMatchCode('Room 6XN84X secret'),undefined);
});

test('two-player presence for fifteen simulated minutes cannot erase a ten-player draft roster',()=>{
  const {state}=roomHarness();state.apply(matchEvent(),'M95Z2Z');
  for(let minute=0;minute<15;minute++){
    const update=state.apply({type:'room.presence.updated',matchId:'M95Z2Z',participants:players(2)},'M95Z2Z');
    assert.equal(update.roster.players.length,10);
  }
  assert.equal(state.draft.teams.team1.name,'Blue');
});

test('team-scoped assignment replaces only that side and rejects old revisions',()=>{
  const {state}=roomHarness();state.apply(matchEvent(),'M95Z2Z');
  const members=players(2).map(p=>({...p,team:'team2',actorUserId:p.userId,discordId:String(BigInt(p.discordId)+100n)}));
  const event={type:'participant.uma-assignments.snapshot',matchId:'M95Z2Z',team:'team2',revision:3,roster:members,assignments:[{selectedUmaId:'secret-not-forwarded'}]};
  const update=state.apply(event,'M95Z2Z');
  assert.equal(update.roster.teams.team1.players.length,5);assert.equal(update.roster.teams.team2.players.length,2);
  assert.equal(state.apply({...event,revision:2,roster:[]},'M95Z2Z').reason,'old-assignment-revision');
  assert.equal(state.roster.players.length,7);
});

test('presence supports real waiting-room departures; authoritative removals work after draft',()=>{
  const {state}=roomHarness();state.apply(matchEvent({phase:'lobby',members:null}),'M95Z2Z');
  state.apply({type:'room.presence.updated',matchId:'M95Z2Z',participants:players(10)},'M95Z2Z');
  state.apply({type:'room.presence.updated',matchId:'M95Z2Z',participants:players(2)},'M95Z2Z');assert.equal(state.roster.players.length,2);
  state.apply(matchEvent({version:2}),'M95Z2Z');state.apply(matchEvent({version:3,members:[]}), 'M95Z2Z');assert.equal(state.roster.players.length,0);
});

test('new room starts a new version sequence and rejects late old-room events',()=>{
  const {state}=roomHarness();state.apply(matchEvent({version:80}),'M95Z2Z');
  state.apply(matchEvent({room:'NEW123',version:1,members:players(2)}),'NEW123');
  assert.equal(state.matchCode,'NEW123');assert.equal(state.version,1);
  assert.equal(state.apply(matchEvent({version:81}),'NEW123').reason,'unrelated-room');assert.equal(state.roster.players.length,2);
});

test('confirmed draft snapshots ignore preview/history duplicates and accept a newer undo',()=>{
  const {state,c}=roomHarness();const event=matchEvent({phase:'complete',rules:{map:{picksPerTeam:3,bansPerTeam:2},uma:{teamSize:5,preBansPerTeam:0,postBansPerTeam:0}}});
  event.state.team1.pickedUmas=[{id:'100101',name:'Outfit A'}];
  event.state.availableUmas=[{id:'100102',name:'Not picked'}];event.state.draftActionHistory=[{uma:{id:'100103',name:'Undone'}}];
  event.state.pendingSelection={uma:{id:'100104',name:'Preview'}};
  const clean=c.decodeRoomEvent('42'+JSON.stringify(['server:event',event]));
  const result=state.apply(clean,'M95Z2Z');assert.equal(result.draft.teams.team1.umas.length,1);assert.equal(result.draft.rules.picks,5);assert.equal(result.draft.rules.bans,0);
  assert.equal(result.draft.rules.mapVetoes,2,'the map veto count is read from rules.map.bansPerTeam');
  const undo=matchEvent({phase:'uma-pick',version:2});state.apply(undo,'M95Z2Z');
  assert.equal(state.draft.phase,'uma-pick');assert.equal(state.draft.teams.team1.umas.length,0);
  assert.equal(state.apply(event,'M95Z2Z').reason,'old-version');
});

test('map veto count defaults to 1 when rules.map.bansPerTeam is absent',()=>{
  const {state}=roomHarness();
  const result=state.apply(matchEvent({phase:'complete',rules:{map:{picksPerTeam:4},uma:{teamSize:6,preBansPerTeam:2,postBansPerTeam:1}}}),'M95Z2Z');
  assert.equal(result.draft.rules.mapVetoes,1);
});

test('event decoding ignores chat and removes unrelated sensitive fields',()=>{
  const {c}=roomHarness();assert.equal(c.decodeRoomEvent(['room:chat',{participants:players()}]),null);
  const event=matchEvent();event.assignmentToken='SECRET';event.state.multiplayer.assignmentToken='SECRET';event.state.chatMessages=['SECRET'];
  assert(!JSON.stringify(c.decodeRoomEvent(event)).includes('SECRET'));
  assert.equal(c.decodeRoomEvent('x'.repeat(2_000_001)),null);
});

test('an explicit team assignment moves a player instead of leaving duplicate identities',()=>{
  const {state}=roomHarness();state.apply(matchEvent(),'M95Z2Z');
  state.apply({type:'participant.uma-assignments.snapshot',matchId:'M95Z2Z',team:'team2',revision:1,roster:[{...players(1)[0],team:'team2'}]},'M95Z2Z');
  assert.equal(state.roster.teams.team1.players.length,4);assert.equal(state.roster.teams.team2.players.length,1);
  assert.equal(new Set(state.roster.players.map(p=>p.discordId)).size,state.roster.players.length);
});

test('confirmed maps use the drafter combined order and preserve distinct course identities',()=>{
  const {state}=roomHarness(); const event=matchEvent();
  for(const team of ['team1','team2']) event.state[team].pickedMaps=[1,2,3].map(n=>({id:`${team}-${n}`,track:'Nakayama',distance:2000+n*100,
    surface:'Turf',variant:'Inner',direction:'Right',conditions:{season:'Spring',weather:'Sunny',ground:'Good'}}));
  event.state.team1.bannedMaps=[{id:'veto',track:'Nakayama',distance:2500}];
  event.state.wildcardMap={id:'wild',track:'Hanshin',distance:2200,surface:'Dirt',conditions:{season:'Winter',weather:'Rain',ground:'Heavy'}};
  const {draft}=state.apply(event,'M95Z2Z');
  assert.deepEqual(Array.from(draft.teams.team1.maps,m=>m.order),[1,3,5,undefined]);
  assert.deepEqual(Array.from(draft.teams.team2.maps,m=>m.order),[2,4,6]);
  assert.equal(new Set(draft.teams.team1.maps.map(m=>m.mapId)).size,4);
  assert.deepEqual({ ...draft.teams.team1.maps[0] }, {team:'team1',mapId:'team1-1',name:'Nakayama',
    details:'2100m • Turf • Inner • Right • Spring • Sunny • Good',track:'Nakayama',distance:2100,
    surface:'Turf',variant:'Inner',direction:'Right',season:'Spring',weather:'Sunny',ground:'Good',order:1,status:'selected'});
  assert.equal(draft.teams.team1.maps[3].distance,2500);
  assert.equal(draft.tiebreakerMap.track,'Hanshin');
  assert.equal(draft.tiebreakerMap.season,'Winter');
  assert.equal(draft.tiebreakerMap.ground,'Heavy');
});

test('custom-room nickname and companion identities survive empty initialization snapshots',()=>{
  for (const nickname of [null,'Mimi','Fixture Query']) {
    const {state,c}=roomHarness();evaluate(c,'rosterIdentity');
    state.apply(matchEvent({room:'CUSTOM',phase:'lobby',members:null}),'CUSTOM');
    const participant={actorUserId:'actor-rumi',discordId:'100000000000000099',displayName:'Fixture Query',nickname,role:'captain',team:'team1'};
    state.apply({type:'room.presence.updated',matchId:'CUSTOM',participants:[participant],rankedQueueRoster:[]},'CUSTOM');
    state.apply({type:'participant.uma-assignments.snapshot',matchId:'CUSTOM',team:'team1',revision:0,roster:[]},'CUSTOM');
    state.apply(matchEvent({room:'CUSTOM',phase:'lobby',version:2,members:[]}),'CUSTOM');
    const name=nickname??'Fixture Query';
    assert.equal(state.roster.players.length,1);
    assert.equal(state.roster.players[0].discordId,participant.discordId);
    assert.equal(state.roster.players[0].displayName,name);
    const dom=domHarness(lobbyFixture(realTrainerRow(name,'/uma/companion.png'),'<p>Waiting for player...</p>'));
    const visible=dom.c.extractPrematchRosterFromRoomDom(dom.document);visible.matchCode='CUSTOM';
    assert.equal(c.canReuseSyncedRoster(state.roster,visible),true);
    state.apply(matchEvent({room:'CUSTOM',phase:'map-pick',version:3,members:[]}),'CUSTOM');
    assert.equal(state.roster.players[0].discordId,participant.discordId);
  }
});

test('custom-room presence still updates nicknames, teams and genuine lobby departures',()=>{
  const {state}=roomHarness();state.apply(matchEvent({phase:'lobby',members:[]}),'M95Z2Z');
  const person={...players(1)[0],nickname:'Mimi',role:'captain'};
  state.apply({type:'room.presence.updated',matchId:'M95Z2Z',participants:[person]},'M95Z2Z');
  state.apply({type:'participant.uma-assignments.snapshot',matchId:'M95Z2Z',team:'team1',revision:0,roster:[]},'M95Z2Z');
  state.apply({type:'room.presence.updated',matchId:'M95Z2Z',participants:[{...person,nickname:'New nick',team:'team2'}]},'M95Z2Z');
  assert.equal(state.roster.players[0].displayName,'New nick');assert.equal(state.roster.players[0].team,'team2');
  state.apply({type:'room.presence.updated',matchId:'M95Z2Z',participants:[]},'M95Z2Z');
  assert.equal(state.roster.players.length,0);
});

test('initial empty assignment for either side cannot clear ranked membership',()=>{
  const {state}=roomHarness();state.apply(matchEvent(),'M95Z2Z');
  for(const team of ['team1','team2'])state.apply({type:'participant.uma-assignments.snapshot',matchId:'M95Z2Z',team,revision:0,roster:[]},'M95Z2Z');
  assert.equal(state.roster.players.length,10);
  state.apply({type:'participant.uma-assignments.snapshot',matchId:'M95Z2Z',team:'team1',revision:1,roster:players(10).filter(p=>p.team==='team1')},'M95Z2Z');
  state.apply({type:'participant.uma-assignments.snapshot',matchId:'M95Z2Z',team:'team1',revision:2,roster:[]},'M95Z2Z');
  assert.equal(state.roster.teams.team1.players.length,0);assert.equal(state.roster.teams.team2.players.length,5);
});

test('room nickname maps override old display names without changing account identity',()=>{
  const {c}=roomHarness();const p={...players(1)[0],actorUserId:'actor-one',userId:'actor-one',displayName:'Original'};
  const result=c.normalizePrematchPlayer(p,{participantNicknames:{'actor-one':'New nickname'}});
  assert.equal(result.displayName,'New nickname');assert.equal(result.discordId,p.discordId);
});
