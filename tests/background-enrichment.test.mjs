import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { tick, waitUntil, players, roster, apiHarness, backgroundHarness, summaryFor } from './support/helpers.mjs';

test('scout window opens before profiles resolve and rapid clicks create one window',async()=>{
  const h=backgroundHarness();await Promise.all([h.c.openScoutWindow(),h.c.openScoutWindow()]);
  assert.equal(h.windowCount,1); await tick();
  assert.equal(h.fetches.length,1);h.fetches[0].gate.resolve();await tick();
});

test('same membership and team/phase changes share one enrichment run',async()=>{
  const h=backgroundHarness();const p=h.c.enrichRosterProfiles(roster());
  const r=roster();r.phase='draft';r.players[0].team='team2';
  const q=h.c.enrichRosterProfiles(r);assert.equal(p,q);await tick();assert.equal(h.fetches.length,1);
  for(let i=0;i<20;i++) assert.equal(h.c.enrichRosterProfiles({...r,phase:`phase-${i}`}),p);
  h.fetches[0].gate.resolve();await p;
});

test('background marks a roster complete only when both sides have five slots',async()=>{
  for(const [count,expected] of [[9,false],[10,true]]) {
    const h=backgroundHarness();const pending=h.c.enrichRosterProfiles(roster('ROOM01',count));
    await waitUntil(()=>h.fetches.length===1);
    assert.equal(h.fetches[0].options.rosterComplete,expected);
    h.fetches[0].gate.resolve();await pending;
  }
});

test('newcomer badge support: no all-time request when season matches already meet the threshold',async()=>{
  const h=backgroundHarness();const r=roster();const pending=h.c.enrichRosterProfiles(r);
  await waitUntil(()=>h.fetches.length===1);
  h.fetches[0].gate.resolve(Object.fromEntries(r.players.map(p=>[p.discordId,summaryFor(p,{matches:10})])));
  await pending;
  assert.equal(h.allTimeFetches.length,0,'season matches >=10 needs no all-time lookup');
});

test('newcomer badge support: fetches all-time stats in the background for players under 10 season games',async()=>{
  const h=backgroundHarness();const r=roster();
  h.allTimeStatsResponses=Object.fromEntries(r.players.map(p=>[p.discordId,
    {wins:2,losses:2,winRate:0.5,matches:4,points:8,pointsPerGame:2,podiums:1,mvpMatches:0,topUmas:[],bestUmas:[],allUmas:[],recentMatches:[]}]));
  const pending=h.c.enrichRosterProfiles(r);
  await waitUntil(()=>h.fetches.length===1);
  h.fetches[0].gate.resolve(Object.fromEntries(r.players.map(p=>[p.discordId,summaryFor(p,{matches:5})])));
  await pending;
  assert.equal(h.allTimeFetches.length,r.players.length,'every under-threshold player gets exactly one background lookup');
  const finalSnapshot=h.snapshots[h.snapshots.length-1];
  for(const p of r.players) assert.equal(finalSnapshot.profiles[p.discordId].allTimeStats.matches,4);
});

test('newcomer badge support: no all-time request when the lobby itself is already showing all-time stats',async()=>{
  const h=backgroundHarness();vm.runInContext("selectedStatsScope = 'allTime';",h.c);
  const r=roster();const pending=h.c.enrichRosterProfiles(r);
  await waitUntil(()=>h.fetches.length===1);
  assert.equal(h.fetches[0].options.scope,'allTime');
  h.fetches[0].gate.resolve(Object.fromEntries(r.players.map(p=>[p.discordId,summaryFor(p,{matches:3,statsScope:'allTime'})])));
  await pending;
  assert.equal(h.allTimeFetches.length,0,'all-time scope already has the real numbers, no extra request needed');
});

test('a roster missing team2 loads with the settling wait',async()=>{
  const h=backgroundHarness();const incomplete=roster('ROOM01',10);
  incomplete.teams={team1:{id:'team1',players:incomplete.players.slice(0,5)}};
  const pending=h.c.performRosterEnrichment(incomplete,{},0,new AbortController().signal);
  await waitUntil(()=>h.fetches.length===1);
  assert.equal(h.fetches[0].options.rosterComplete,false);
  h.fetches[0].gate.resolve();await pending;
});

test('failed refresh preserves usable cached data, but confirmed private responses replace it',()=>{
  const h=backgroundHarness();
  const previous={discordId:'1',matches:5,fetchedAt:123};
  const failure={discordId:'1',matches:null,fetchedAt:456,error:'Network failed',statsPrivate:false};
  const retained=h.c.retainUsableProfile(previous,failure);
  assert.equal(retained.matches,5);assert.equal(retained.fetchedAt,123);assert.equal(retained.error,'Network failed');
  const privateResponse={...failure,statsPrivate:true};
  assert.equal(h.c.retainUsableProfile(previous,privateResponse),privateResponse);
});

test('obsolete runs cannot overwrite a newer room snapshot',async()=>{
  const h=backgroundHarness();const old=h.c.enrichRosterProfiles(roster('OLD'));await tick();
  const fresh=h.c.enrichRosterProfiles(roster('NEW'));await tick();
  assert(h.fetches[0].options.signal.aborted);
  await h.fetches[0].options.onStart(players()[0]);
  h.fetches[0].gate.resolve();await old;
  assert.equal(h.snapshots.at(-1).matchCode,'NEW');
  h.fetches[1].gate.resolve();await fresh;
});

test('fresh cached profiles need no network',async()=>{
  const api=apiHarness();const profiles=await api.c.fetchPlayerProfileSummaries(players());
  const h=backgroundHarness();h.cached={profiles};await h.c.enrichRosterProfiles(roster());
  assert.equal(h.fetches.length,0);assert.equal(h.snapshots.at(-1).loadingDiscordIds.length,0);
});

test('manual refresh is not blocked by reconnect writing a fresh cache timestamp',async()=>{
  const h=backgroundHarness();h.cached={updatedAt:Date.now(),profiles:{}};
  await h.c.handleProfileRefreshRequested(roster());await tick();
  assert.equal(h.fetches.length,1);
  await h.c.handleProfileRefreshRequested(roster());await tick();assert.equal(h.fetches.length,1);
  h.fetches[0].gate.resolve();await tick();
});

test('A9C7T2 fixture scouts 9 team-slot players and never the 4 spectators',async()=>{
  const h=backgroundHarness();
  const slots=players(10).slice(1); // team1 4/5, team2 5/5
  const spectators=players(4).map((p,i)=>({...p,userId:`spectator${i}`,discordId:String(900000000000000000n+BigInt(i)),team:undefined}));
  const input={matchCode:'A9C7T2',players:[...slots,...spectators]};
  h.latest=input;
  const normalized=h.c.normalizeRosterForDisplay(input);
  assert.equal(normalized.players.length,9);
  assert.equal(normalized.teams.team1.players.length,4);
  assert.equal(normalized.teams.team2.players.length,5);
  const pending=h.c.enrichRosterProfiles(input);await tick();
  assert.equal(h.fetches[0].players.length,9);
  assert(h.fetches[0].players.every(p=>slots.some(slot=>slot.discordId===p.discordId)));
  assert.equal(h.snapshots.at(-1).loadingDiscordIds.length,9);
  h.fetches[0].gate.resolve();await pending;
});

test('returning to an earlier lobby restores its profiles without new API requests',async()=>{
  const api=apiHarness();const profiles=await api.c.fetchPlayerProfileSummaries(players());
  const h=backgroundHarness();h.cached={matchCode:'ROOM01',profiles};
  const other={matchCode:'ROOM02',players:players().map(p=>({...p,userId:'9'+p.userId,discordId:'9'+p.discordId}))};
  const next=h.c.enrichRosterProfiles(other);await tick();
  assert.equal(h.snapshots.at(-1).matchCode,'ROOM02','new room renders while its requests are unresolved');
  h.fetches[0].gate.resolve();await next;
  await h.c.enrichRosterProfiles(roster());
  assert.equal(h.fetches.length,1,'returning players are served from the cross-room archive');
  assert.equal(Object.keys(h.snapshots.at(-1).profiles).length,5);
  assert.equal(h.snapshots.at(-1).loadingDiscordIds.length,0);
});

test('activating another drafter tab follows its roster without waiting for profile requests',async()=>{
  const h=backgroundHarness();const next=roster('NEXT01');
  h.c.browser.tabs.get=async id=>({id,active:true,url:'https://drafter.uma.guide/spectate/NEXT01'});
  h.c.extractMatchCodeFromUrl=url=>new URL(url).pathname.split('/').at(-1);
  h.c.clearLatestPrematchRoster=async()=>{};h.c.clearLatestDraftSnapshot=async()=>{};
  h.c.sendRoomDomScanRequest=async()=>{await h.c.handlePrematchRosterDetected(next);return{activeLobby:true,matchCode:'NEXT01'};};
  await h.c.handleActiveDrafterTab(2);await tick();
  assert.equal(h.snapshots.at(-1).matchCode,'NEXT01');assert.equal(h.fetches.length,1);
  assert.equal(vm.runInContext('selectedDrafterTabId',h.c),2);
  h.fetches[0].gate.resolve();await tick();
});

test('scope switch cancels old work and passes the new scope through the background loader',async()=>{
  const h=backgroundHarness();const first=h.c.enrichRosterProfiles(roster());await tick();
  assert.equal(h.fetches[0].options.scope,'currentSeason');
  vm.runInContext("selectedStatsScope = 'allTime'",h.c);
  const second=h.c.enrichRosterProfiles(roster());await tick();
  assert.equal(h.fetches.length,2);assert.equal(h.fetches[0].options.signal.aborted,true);assert.equal(h.fetches[1].options.scope,'allTime');
  h.fetches[0].gate.resolve();h.fetches[1].gate.resolve();await Promise.all([first,second]);
});

test('unchanged warm rosters do not republish profiles or reset their age across draft events',async()=>{
  const api=apiHarness(); const profiles=await api.c.fetchPlayerProfileSummaries(players());
  const h=backgroundHarness(); h.cached={profiles}; await h.c.enrichRosterProfiles(roster());
  const original=h.snapshots.at(-1), count=h.snapshots.length;
  for(let i=0;i<25;i++) { h.advance(20_000); await h.c.enrichRosterProfiles({...roster(),phase:`phase-${i}`}); }
  assert.equal(h.fetches.length,0); assert.equal(h.snapshots.length,count);
  assert.equal(h.snapshots.at(-1).updatedAt,original.updatedAt);
  await h.c.enrichRosterProfiles(roster('NEXT01'));
  assert.equal(h.snapshots.at(-1).matchCode,'NEXT01'); assert.equal(h.fetches.length,0);
});

test('manual refresh cooldown survives restart and is not extended by roster updates',async()=>{
  const stored={profileManualRefreshAt:Date.now()}; const h=backgroundHarness({stored});
  await h.c.restoreManualRefresh(); await h.c.handleProfileRefreshRequested(roster());
  assert.equal(h.fetches.length,0);
  h.advance(21_000); await h.c.handleProfileRefreshRequested(roster()); await tick();
  assert.equal(h.fetches.length,1); assert.equal(h.snapshots.at(-1).manualRefreshAt,h.now);
  h.fetches[0].gate.resolve(); await tick();
  assert.equal(h.stored.profileManualRefreshAt,h.now);
});
