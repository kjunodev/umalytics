import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { parseHTML } from 'linkedom';
const root = new URL('../apps/extension/', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise,resolve}; };
const tick = () => new Promise(r => setImmediate(r));
const sleep = ms => new Promise(r => setTimeout(r,ms));
function context(globals = {}) {
  return vm.createContext({console, URL, URLSearchParams, AbortController, DOMException, setTimeout, clearTimeout,
    defineBackground: () => {}, defineContentScript: () => {}, recordDiagnostic: () => {}, sendDiagnosticEvent: async () => {}, getLatestDraftSnapshot: async () => undefined, clearLatestDraftSnapshot: async () => {}, ...globals});
}
function evaluate(c, file, options = {}) {
  if (file === 'entrypoints/content.ts') { evaluate(c,'utils/roomEvents.ts'); evaluate(c,'utils/rosterIdentity.ts'); }
  let source = options.source ?? read(file);
  source = source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export default /gm,'').replace(/^export /gm,'');
  if (options.fast) source = source
    .replace(/const API_REQUEST_TIMEOUT_MS = [^;]+;/, 'const API_REQUEST_TIMEOUT_MS = 120;')
    .replace(/const PROFILE_SUMMARY_TIMEOUT_MS = [^;]+;/, 'const PROFILE_SUMMARY_TIMEOUT_MS = 1500;')
    .replace('15_000','300')
    .replace('const DEFAULT_REQUEST_INTERVAL_MS = 500;', 'const DEFAULT_REQUEST_INTERVAL_MS = 1;');
  vm.runInContext(stripTypeScriptTypes(source, {mode:'transform'}),c);
}
function players(count=5) {
  return Array.from({length:count},(_,i)=>({userId:String(100000000000000000n+BigInt(i)),discordId:String(100000000000000000n+BigInt(i)),displayName:`Player ${i}`,team:i<(count===10?5:2)?'team1':'team2',partyId:null,partyRatingBonus:0}));
}
const roster = (match='ROOM01', count=5) => ({matchCode:match,players:players(count)});
const stats = {summary:{matchesIncluded:4,totalPointsScored:12},umaEntries:[{umaId:'100101',matches:4,wins:2,losses:2,pointsScored:12}]};
function apiHarness({privateBuild=false, responder, latency=2}={}) {
  const calls=[]; let active=0, peak=0, aborts=0;
  const c=context({__UMALYTICS_PRIVATE_PROFILE_DATA__:privateBuild,
    fetch:async (url,init)=>{
      calls.push(url.pathname+url.search); active++; peak=Math.max(peak,active);
      const response=responder?.(url,init) ?? {};
      let finished=false;
      const finish=()=>{if(!finished){finished=true;active--;init.signal.removeEventListener('abort',abort);}};
      const abort=()=>{aborts++;finish();};
      init.signal.addEventListener('abort',abort,{once:true});
      if (response.status >= 400) finish();
      return {ok:!response.status || response.status<400,status:response.status??200,headers:new Headers(response.headers??{}),json:async()=>{
        try {
          if(response.hang) return await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
          await sleep(latency); init.signal.throwIfAborted();
          return response.body ?? (url.pathname==='/api/seasons'?[{id:'S1',active:true}]:url.pathname==='/api/leaderboard'?{entries:[]}:url.pathname.endsWith('/profile')?{displayName:'Fixture'}:url.pathname.endsWith('/history')?{total:0,playerHistory:[]}:stats);
        } finally {finish();}
      }};
    }
  });
  evaluate(c,'utils/profileConstants.ts'); evaluate(c,'utils/umaReleaseOrder.ts'); evaluate(c,'utils/umaPortraits.ts');
  evaluate(c,'utils/requestQueue.ts');evaluate(c,'utils/playerProfileApi.ts',{fast:true});
  return {c,calls,get peak(){return peak;},get aborts(){return aborts;}};
}

test('profile requests start while shared setup is pending; no HTML/assets requested',async()=>{
  const h=apiHarness({responder:url=>url.pathname==='/api/seasons'?{hang:true}:undefined});
  let starts=0;
  const pending=h.c.fetchPlayerProfileSummaries(players(),{onStart:()=>{starts++;}});
  await sleep(15);
  assert.equal(starts,4);
  assert(h.calls.some(p=>p.endsWith('/profile')));
  assert(!h.calls.some(p=>p.includes('/assets/') || p==='/'));
  const result=await pending;
  assert.equal(Object.keys(result).length,5);
  assert(Object.values(result).every(p=>p.error?.includes('timed out')));
});

test('10-player cold load respects global request cap and returns usable stats',async()=>{
  const h=apiHarness(); const summaries=[];
  const result=await h.c.fetchPlayerProfileSummaries(players(10),{onSummary:s=>summaries.push(s)});
  assert.equal(summaries.length,10);assert(h.peak<=3);assert(h.peak>1);
  assert(Object.values(result).every(p=>p.error===undefined && p.matches===4), JSON.stringify(Object.values(result).map(p=>p.error)));
  assert.equal(h.calls.filter(p=>p==='/api/seasons').length,1);
  assert.equal(h.calls.filter(p=>p.startsWith('/api/leaderboard')).length,1);
  assert.equal(h.calls.length,32);
});

test('shared season/leaderboard requests are deduplicated and cached',async()=>{
  const h=apiHarness();
  await Promise.all([h.c.fetchPlayerProfileSummaries(players(1)),h.c.fetchPlayerProfileSummaries(players(1))]);
  await h.c.fetchPlayerProfileSummaries(players(1));
  assert.equal(h.calls.filter(p=>p==='/api/seasons').length,1);
  assert.equal(h.calls.filter(p=>p.startsWith('/api/leaderboard')).length,1);
});

test('hung response bodies are cancelled and all queued profiles reach a terminal result',async()=>{
  const h=apiHarness({responder:url=>url.pathname.includes('/players/')?{hang:true}:undefined});
  const result=await h.c.fetchPlayerProfileSummaries(players(10));
  assert.equal(Object.keys(result).length,10);
  assert(Object.values(result).every(p=>p.error?.includes('timed out')));
  assert(h.aborts>0);
});

test('cancelling a roster aborts active requests and does not start queued profiles',async()=>{
  const h=apiHarness({responder:url=>url.pathname.includes('/players/')?{hang:true}:undefined});
  const controller=new AbortController(); let summaries=0;
  const pending=h.c.fetchPlayerProfileSummaries(players(10),{signal:controller.signal,onSummary:()=>{summaries++;}});
  await sleep(15);controller.abort(new Error('Switched rooms'));
  await assert.rejects(pending,/Switched rooms/);
  assert.equal(summaries,0);assert(h.aborts>0);
});

test('public source stops at private stats even if a runtime flag is supplied',async()=>{
  for (const privateBuild of [false,true]) {
    const h=apiHarness({privateBuild,responder:url=>url.pathname.endsWith('/stats')?{status:403}:undefined});
    const result=await h.c.fetchPlayerProfileSummaries(players(1));
    assert.equal(h.calls.filter(p=>p.includes('/history')).length,0);
    assert.equal(Object.values(result)[0].statsPrivate,true);
  }
  const h=apiHarness({privateBuild:true});await h.c.fetchPlayerProfileSummaries(players(1));
  assert.equal(h.calls.filter(p=>p.includes('/history')).length,0);
});

test('rate limits fail explicitly without sleeping or issuing a retry storm',async()=>{
  const h=apiHarness({responder:url=>url.pathname==='/api/seasons'?{status:429,headers:{'retry-after':'30'}}:undefined});
  const start=performance.now(); const result=await h.c.fetchPlayerProfileSummaries(players(10));
  assert(performance.now()-start<500);
  assert(Object.values(result).every(p=>p.error!==undefined));
  assert(h.calls.length<=6);
});

function backgroundHarness({stored = {}} = {}) {
  const snapshots=[],fetches=[],alarms=new Map();let cached;let windowCount=0;let clock=Date.now();let latest=roster();let archive={};
  class Clock extends Date { static now(){return clock;} }
  const c=context({Date:Clock, getApiCooldown:()=>undefined,restoreApiCooldown:()=>{},
    browser:{storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,structuredClone(value)),remove:async key=>{delete stored[key];}}},
      alarms:{clear:async name=>alarms.delete(name),create:async(name,info)=>alarms.set(name,info)},tabs:{query:async()=>[{id:1,active:true,url:'https://drafter.uma.guide/spectate/ROOM01'}]},scripting:{executeScript:async()=>{}},runtime:{getURL:p=>p},windows:{create:async()=>({id:++windowCount}),update:async()=>{}}},
    getLobbyLockState:async()=>undefined,setLatestPrematchRoster:async()=>{},getLatestPrematchRoster:async()=>latest,
    extractMatchCodeFromUrl:()=> 'ROOM01',getPlayerProfileSummaries:async()=>cached,
    getCachedPlayerProfiles:async()=>archive,rememberCachedPlayerProfiles:async profiles=>{archive=c.mergeProfileCache(archive,profiles,clock);},
    setPlayerProfileSummaries:async s=>{cached=structuredClone(s);snapshots.push(cached);},
    isHashedUmaAssetUrl:()=>false,
    fetchPlayerProfileSummaries:async (p,options)=>{const gate=deferred();fetches.push({players:p,options,gate});return await gate.promise ?? {};},
    sendRoomDomScanRequest:async()=>{await c.handlePrematchRosterDetected(roster());return{activeLobby:true,matchCode:'ROOM01'};}
  });
  evaluate(c,'utils/profileConstants.ts');evaluate(c,'utils/rosterDisplay.ts');evaluate(c,'utils/profileCache.ts');evaluate(c,'entrypoints/background.ts');
  return {c,snapshots,fetches,alarms,stored,advance(ms){clock+=ms;},get now(){return clock;},get windowCount(){return windowCount;},set cached(s){cached=s;},set latest(r){latest=r;}};
}

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

test('failed refresh preserves usable cached data, but confirmed private responses replace it',()=>{
  const h=backgroundHarness();
  const previous={discordId:'1',matches:5,fetchedAt:123};
  const failure={discordId:'1',matches:null,fetchedAt:456,error:'Network failed',statsPrivate:false};
  const retained=h.c.retainUsableProfile(previous,failure);
  assert.equal(retained.matches,5);assert.equal(retained.fetchedAt,123);assert.equal(retained.error,'Network failed');
  const privateResponse={...failure,statsPrivate:true};
  assert.equal(h.c.retainUsableProfile(previous,privateResponse),privateResponse);
});

test('API failure cannot relabel all-time results as current-season results',async()=>{
  const h=apiHarness({responder:url=>url.pathname==='/api/seasons'?{status:404}:undefined});
  const result=Object.values(await h.c.fetchPlayerProfileSummaries(players(1)))[0];
  assert.equal(result.allTimeStats.matches,4);assert.equal(result.currentSeasonStats.matches,null);
  assert.equal(result.currentSeasonStats.wins,null);assert(result.error);
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

test('duplicate content scans coalesce while acknowledgement is pending; failed sends can retry',async()=>{
  const gate=deferred();let sends=0;
  const c=context({sendPrematchRoster:()=>{sends++;return gate.promise;}});evaluate(c,'entrypoints/content.ts');
  const a=c.publishRoster(roster(),'synced'),b=c.publishRoster(roster(),'synced');await tick();assert.equal(sends,1);
  gate.resolve();await Promise.all([a,b]);
  let fail=true;c.sendPrematchRoster=async()=>{sends++;if(fail)throw new Error('Connection error');};
  await assert.rejects(c.publishRoster(roster('NEXT'),'synced'),/Connection error/);
  fail=false;await c.publishRoster(roster('NEXT'),'synced');assert.equal(sends,3);
});

test('DOM draft updates preserve phase/turn within a match, never across matches',async()=>{
  const sent=[];const c=context({sendDraftSnapshot:async s=>sent.push(s),window:{location:{href:'https://drafter.uma.guide/spectate/ROOM01'}},extractMatchCodeFromUrl:()=> 'ROOM01'});
  evaluate(c,'entrypoints/content.ts');
  const teams={team1:{id:'team1',maps:[],umas:[]},team2:{id:'team2',maps:[],umas:[]}};
  await c.publishDraftSnapshot({matchCode:'ROOM01',teams,phase:'pick',currentTeam:'team1',source:'synced-draft-state'});
  teams.team1.umas.push({kind:'pick',name:'Uma'});
  await c.publishDraftSnapshot({matchCode:'ROOM01',teams,source:'draft-dom'});
  assert.equal(sent.at(-1).phase,'pick');assert.equal(sent.at(-1).currentTeam,'team1');
  await c.publishDraftSnapshot({matchCode:'NEXT',teams,source:'draft-dom'});
  assert.equal(sent.at(-1).phase,undefined);
});

test('team normalization resolves final/initial teams and drops spectators without slots',()=>{
  const c=context({cleanTeamName:x=>x});evaluate(c,'utils/syncPayload.ts');evaluate(c,'utils/playerExtraction.ts');
  evaluate(c,'utils/rosterDisplay.ts');
  const fixture={syncedDraftState_multiplayer:{roomId:'ROOM01',participants:players().map((p,i)=>i<2?{...p,team:undefined,finalTeam:'team1'}:p)}};
  const r=c.normalizeRosterForDisplay(c.extractPrematchRosterFromSyncedDraftState(fixture));
  assert.equal(r.players.length,5);assert.equal(r.teams.team1.players.length,2);assert.equal(r.teams.team2.players.length,3);
  fixture.syncedDraftState_multiplayer.participants[0].finalTeam=undefined;
  const partial=c.normalizeRosterForDisplay(c.extractPrematchRosterFromSyncedDraftState(fixture));
  assert.equal(partial.players.length,4);assert.equal(partial.players.filter(p=>p.team===undefined).length,0);
  assert.equal(c.getTeamGroups(partial).flatMap(t=>t.players).length,4);
});

test('forced reconnect replays rich synced roster instead of replacing it with partial DOM data',async()=>{
  const sent=[];const c=context({sendPrematchRoster:async r=>sent.push(r)});evaluate(c,'entrypoints/content.ts');
  await c.publishRoster(roster(),'synced');
  await c.publishRoster(roster('ROOM01',1),'dom',{force:true});
  assert.equal(sent.length,2);assert.equal(sent.at(-1).players.length,5);
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

test('explicit spectator roles and cleared current slots override historical teams',()=>{
  const c=context({cleanTeamName:x=>x});evaluate(c,'utils/syncPayload.ts');evaluate(c,'utils/playerExtraction.ts');
  const fixture=players(5);
  fixture[0]={...fixture[0],role:'Spectator'};
  fixture[1]={...fixture[1],roomRole:'spectator',role:'captain'};
  fixture[2]={...fixture[2],team:null,initialTeam:'team1',finalTeam:'team2'};
  const result=c.normalizePrematchRosterFromPlayers(fixture,'ROOM01');
  assert.equal(result.players.length,2);
  assert(result.players.every(p=>['Player 3','Player 4'].includes(p.displayName)));
});

test('cooldown preserves HTTP cause and successful endpoints are reused on recovery',async()=>{
  let clock=Date.now();class Clock extends Date {static now(){return clock;}}
  let failing=true;
  const h=apiHarness({responder:url=>url.pathname.endsWith('/stats') && failing?{status:429,headers:{'retry-after':'30'}}:undefined});
  h.c.Date=Clock;
  const first=await h.c.fetchPlayerProfileSummaries(players(1));
  assert(Object.values(first)[0].error);
  const cooldown=h.c.getApiCooldown();
  assert.equal(cooldown.status,429);assert(cooldown.path.includes('/stats'));
  assert.equal(cooldown.until,clock+30000);
  const callsBefore=h.calls.length;
  await h.c.fetchPlayerProfileSummaries(players(1));
  assert.equal(h.calls.length,callsBefore,'no HTTP requests while cooling down');
  const profileCallsBefore=h.calls.filter(p=>p.endsWith('/profile')).length;
  failing=false;clock=cooldown.until;
  const result=Object.values(await h.c.fetchPlayerProfileSummaries(players(1)))[0];
  assert.equal(result.error,undefined);assert.equal(result.allTimeStats.matches,4);
  assert.equal(h.calls.filter(p=>p.endsWith('/profile')).length,profileCallsBefore,'successful profile endpoint reused');
});

test('HTTP date Retry-After and server failures preserve their recovery deadline',async()=>{
  for(const status of [429,503]) {
    const until=Math.ceil((Date.now()+90000)/1000)*1000;
    const h=apiHarness({responder:()=>({status,headers:{'retry-after':new Date(until).toUTCString()}})});
    await h.c.fetchPlayerProfileSummaries(players(1));
    assert.equal(h.c.getApiCooldown().until,until);assert.equal(h.c.getApiCooldown().status,status);
  }
});

function failBatch(h,index=0) {
  const cooldown={until:h.now+30000,status:429,path:'/api/stats/players/fixture/profile'};
  h.c.getApiCooldown=()=>cooldown;
  h.fetches[index].gate.resolve(Object.fromEntries(h.fetches[index].players.map(p=>[p.discordId,{discordId:p.discordId,fetchedAt:h.now,error:'Request failed (HTTP 429): /api/stats/players/fixture/profile'}])));
  return cooldown;
}

test('automatic recovery waits for Retry-After, retries failed players only, then clears the alarm',async()=>{
  const api=apiHarness();const profiles=await api.c.fetchPlayerProfileSummaries(players());
  const h=backgroundHarness();h.cached={profiles};
  // Only one player's cache is stale; the other four must never be fetched.
  profiles[players()[0].discordId].error='Request failed (HTTP 429): /profile';
  const first=h.c.enrichRosterProfiles(roster());await tick();
  assert.equal(h.fetches[0].players.length,1);
  const cooldown=failBatch(h);await first;
  assert.equal(h.alarms.size,1);assert.equal(h.stored.profileRecovery.retryAt,cooldown.until);
  assert.equal(h.snapshots.at(-1).loadingDiscordIds.length,1);
  assert.equal(h.snapshots.at(-1).profileStates[players()[0].discordId].status,'queued');
  await h.c.resumeProfileRecovery();assert.equal(h.fetches.length,1,'early alarm cannot bypass cooldown');
  h.advance(30000);
  const retry=h.c.resumeProfileRecovery();await tick();
  assert.equal(h.fetches.length,2);assert.equal(h.fetches[1].players.length,1);
  const healthy={...profiles[players()[0].discordId],error:undefined};
  h.fetches[1].gate.resolve({[healthy.discordId]:healthy});await retry;
  assert.equal(h.snapshots.at(-1).loadingDiscordIds.length,0);assert.equal(h.alarms.size,0);
  assert.equal(h.stored.profileRecovery,undefined);
  assert(Object.values(h.snapshots.at(-1).profileStates).every(state=>state.status==='loaded'));
});

test('persistent API failures stop after two automatic retries until manual refresh',async()=>{
  const h=backgroundHarness();const first=h.c.enrichRosterProfiles(roster());await tick();failBatch(h);await first;
  for(let i=1;i<=2;i++) {
    h.advance(30000);const retry=h.c.resumeProfileRecovery();await tick();
    assert.equal(h.fetches.length,i+1);failBatch(h,i);await retry;
  }
  assert.equal(h.alarms.size,0);assert.equal(h.stored.profileRecovery.exhausted,true);
  assert.equal(h.snapshots.at(-1).loadingDiscordIds.length,0);
  h.advance(60000);await h.c.resumeProfileRecovery();await h.c.enrichRosterProfiles(roster());
  assert.equal(h.fetches.length,3,'ordinary roster updates cannot reset the retry budget');
  const restarted=backgroundHarness({stored:structuredClone(h.stored)});
  restarted.cached={matchCode:'ROOM01',profiles:{},loadingDiscordIds:players().map(p=>p.discordId),profileStates:Object.fromEntries(players().map(p=>[p.discordId,{discordId:p.discordId,status:'queued'}]))};
  await restarted.c.restoreProfileRecovery();await restarted.c.enrichRosterProfiles(roster());
  assert.equal(restarted.fetches.length,0);
  assert.equal(restarted.snapshots.at(-1).loadingDiscordIds.length,0,'restart repairs queued cards after retry exhaustion');
  const manual=h.c.enrichRosterProfiles(roster(),{forceRefresh:true});await tick();
  assert.equal(h.fetches.length,4);h.fetches[3].gate.resolve();await manual;
});

test('room changes cancel a pending recovery without fetching the old team',async()=>{
  const h=backgroundHarness();const first=h.c.enrichRosterProfiles(roster());await tick();failBatch(h);await first;
  h.latest=roster('NEW');h.advance(30000);await h.c.resumeProfileRecovery();
  assert.equal(h.fetches.length,1);assert.equal(h.alarms.size,0);assert.equal(h.stored.profileRecovery,undefined);
});

test('a background restart restores the cooldown and schedules recovery for the same roster',async()=>{
  const h=backgroundHarness();const first=h.c.enrichRosterProfiles(roster());await tick();failBatch(h);await first;
  const restored=backgroundHarness({stored:structuredClone(h.stored)});
  let restoredCooldown;restored.c.restoreApiCooldown=value=>{restoredCooldown=value;};
  await restored.c.restoreProfileRecovery();
  assert.equal(restoredCooldown.until,h.stored.profileRecovery.cooldown.until);
  assert.equal(restored.alarms.size,1);
  await restored.c.enrichRosterProfiles(roster());
  assert.equal(restored.fetches.length,0,'startup cannot hit API before persisted cooldown ends');
  assert.equal(restored.snapshots.at(-1).loadingDiscordIds.length,5);
  restored.advance(31000);const retry=restored.c.resumeProfileRecovery();await tick();
  assert.equal(restored.fetches.length,1);restored.fetches[0].gate.resolve();await retry;
});

test('returning to an earlier lobby restores its profiles without another API batch',async()=>{
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

test('profile archive excludes partial data and bounds age, count and byte size',()=>{
  const c=context();evaluate(c,'utils/profileCache.ts');const now=Date.now();
  const incoming=Object.fromEntries(Array.from({length:130},(_,i)=>[String(i),{discordId:String(i),fetchedAt:now-i,profileUrl:'fixture'}]));
  incoming.partial={discordId:'partial',fetchedAt:now,isPartial:true};
  incoming.old={discordId:'old',fetchedAt:now-25*60*60*1000};
  let result=c.mergeProfileCache({},incoming,now);assert.equal(Object.keys(result).length,100);
  assert.equal(result.partial,undefined);assert.equal(result.old,undefined);
  result=c.mergeProfileCache({},Object.fromEntries(Object.entries(incoming).map(([id,p])=>[id,{...p,title:'x'.repeat(100000)}])),now);
  assert(JSON.stringify(result).length*2<4*1024*1024);
  assert.equal(result['0'].fetchedAt,now,'reading the cache cannot extend freshness');
});

test('initial all-time stats publish before a slow profile endpoint completes',async()=>{
  const h=apiHarness({responder:url=>url.pathname.endsWith('/profile')?{hang:true}:undefined});
  const usable=deferred();let finished=false;
  const pending=h.c.fetchPlayerProfileSummaries(players(1),{onProgress:p=>{if(p.allTimeStats.matches===4)usable.resolve(p);}}).then(result=>{finished=true;return result;});
  const first=await usable.promise;assert.equal(first.isPartial,true);assert.equal(finished,false);
  const result=Object.values(await pending)[0];assert.equal(result.allTimeStats.matches,4);
});

test('request pacing spaces start times and cancellation does not dispatch abandoned jobs',async()=>{
  const c=context();evaluate(c,'utils/requestQueue.ts');const queue=vm.runInContext('new RequestQueue(3, 30)',c);
  const starts=[];const controller=new AbortController();
  await Promise.all(Array.from({length:4},()=>queue.run(controller.signal,async()=>{starts.push(performance.now());})));
  assert(starts.slice(1).every((time,i)=>time-starts[i]>=27),JSON.stringify(starts));
  const aborter=new AbortController();let called=false;
  const abandoned=queue.run(aborter.signal,async()=>{called=true;});aborter.abort(new Error('Room changed'));
  await assert.rejects(abandoned,/Room changed/);assert.equal(called,false);
});

test('a 429 increases request spacing and the cooldown persists that spacing',async()=>{
  const h=apiHarness({responder:()=>({status:429})});const initial=vm.runInContext('requestStartIntervalMs',h.c);
  await h.c.fetchPlayerProfileSummaries(players(1));
  assert(h.c.getApiCooldown().startIntervalMs>initial);
  const next=apiHarness();next.c.restoreApiCooldown(h.c.getApiCooldown());
  assert.equal(vm.runInContext('requestStartIntervalMs',next.c),h.c.getApiCooldown().startIntervalMs);
});

test('private and public caches are separate and public mode rejects private/legacy private data',async()=>{
  const stored={};const storage={get:async key=>({[key]:stored[key]}),set:async values=>Object.assign(stored,values)};
  function storageContext(privateBuild) {
    const c=context({__UMALYTICS_PRIVATE_PROFILE_DATA__:privateBuild,browser:{storage:{local:storage}}});
    evaluate(c,'utils/profileCache.ts');evaluate(c,'utils/profileStorage.ts');return c;
  }
  const privateContext=storageContext(true);const secret={discordId:'1',fetchedAt:Date.now(),statsPrivate:true,matches:40};
  await privateContext.rememberCachedPlayerProfiles({'1':secret});
  await privateContext.setPlayerProfileSummaries({profiles:{'1':secret},loadingDiscordIds:[]});
  const publicContext=storageContext(false);
  assert.equal(Object.keys(await publicContext.getCachedPlayerProfiles()).length,0);
  assert.equal(await publicContext.getPlayerProfileSummaries(),undefined);
  const legacy=publicContext.filterSnapshotForBuild({profiles:{'1':secret,'2':{discordId:'2',fetchedAt:Date.now()}},loadingDiscordIds:[]});
  assert.equal(legacy.profiles['1'],undefined);assert(legacy.profiles['2']);
});

test('unscoped or foreign socket/storage rosters cannot replace the M95Z2Z team',()=>{
  const c=context();evaluate(c,'utils/syncPayload.ts');
  const small={rankedQueueRoster:players(2).map(p=>({...p,team:'team2'}))};
  assert.equal(c.selectRoomSyncedState(small,'M95Z2Z'),null);
  assert.equal(c.selectRoomSyncedState({roomCode:'OTHER1',data:small},'M95Z2Z'),null);
  const right=c.selectRoomSyncedState({roomCode:'M95Z2Z',data:{syncedDraftState_multiplayer:{rankedQueueRoster:players(10)}}},'M95Z2Z');
  assert.equal(right.syncedDraftState_multiplayer.roomCode,'M95Z2Z');
  assert.equal(right.syncedDraftState_multiplayer.rankedQueueRoster.length,10);
  const batch=c.selectRoomSyncedState([{roomCode:'OTHER1',data:small},{roomCode:'M95Z2Z',data:{rankedQueueRoster:players(10)}}],'M95Z2Z');
  assert.equal(batch.syncedDraftState_multiplayer.rankedQueueRoster.length,10);
});

test('same-room departures and empty rosters remain authoritative; console context is explicit',async()=>{
  const c=context({sendPrematchRoster:async r=>sent.push(r)});const sent=[];
  evaluate(c,'utils/syncPayload.ts');evaluate(c,'entrypoints/content.ts');
  const identified=c.selectRoomSyncedState({roomCode:'M95Z2Z',players:players(2)},'M95Z2Z');
  assert.equal(identified.syncedDraftState_multiplayer.players.length,2);
  assert(c.selectRoomSyncedState({syncedDraftState_multiplayer:{participants:players()}},'M95Z2Z',true));
  assert.equal(c.selectRoomSyncedState({syncedDraftState_multiplayer:{participants:players()}},'M95Z2Z',false),null);
  await c.publishRoster(roster('M95Z2Z',10),'synced');
  await c.publishRoster(roster('M95Z2Z',2),'synced');
  await c.publishRoster({matchCode:'M95Z2Z',players:[]},'synced');
  assert.equal(sent.length,3);assert.equal(sent.at(-1).players.length,0);
});

test('synced payload traversal is bounded and rejects cyclic/foreign nested data',()=>{
  const c=context();evaluate(c,'utils/syncPayload.ts');const cycle={};cycle.self=cycle;
  assert.equal(c.selectRoomSyncedState(cycle,'M95Z2Z'),null);
  assert.equal(c.selectRoomSyncedState({roomCode:'OTHER1',data:{players:players()}},'M95Z2Z',true),null);
  const data={roomCode:'M95Z2Z',roomId:'cec650b6-a357-4d35-9133-7b6db44ae46f'};
  assert.equal(c.readPayloadRoomCode(data),'M95Z2Z');
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

test('content keeps ten players when a later unscoped two-player payload arrives',async()=>{
  const sent=[];const c=context({cleanTeamName:x=>x,document:{},extractRoomCodeFromRoomDom:()=> 'M95Z2Z',
    extractDraftSnapshotFromSyncedDraftState:()=>null,sendPrematchRoster:async r=>sent.push(r)});
  evaluate(c,'utils/syncPayload.ts');evaluate(c,'utils/playerExtraction.ts');evaluate(c,'entrypoints/content.ts');
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

function roomHarness() {
  const c=context({cleanTeamName:x=>x, getUmaDisplayName:(id,name)=>name??id, normalizeUmaOutfitId:x=>x});
  evaluate(c,'utils/matchDetection.ts');evaluate(c,'utils/syncPayload.ts');evaluate(c,'utils/playerExtraction.ts');evaluate(c,'utils/roomEvents.ts');
  return {c,state:vm.runInContext('new RoomEventState()',c)};
}
function matchEvent({room='M95Z2Z',version=1,phase='map-pick',members=players(10),rules}={}) {
  const team=()=>({pickedUmas:[],bannedUmas:[],preBannedUmas:[],pickedMaps:[],bannedMaps:[]});
  return {type:'match.snapshot',matchId:room,version,state:{phase,currentTeam:'team1',team1:team(),team2:team(),rules,
    multiplayer:{team1Name:'Blue',team2Name:'Red',...(members===null?{}:{rankedQueueRoster:members})}}};
}

test('room code normalization supports host display and join/spectate routes',()=>{
  const {c}=roomHarness();
  assert.equal(c.normalizeMatchCode('6XN-84X'),'6XN84X');
  assert.equal(c.extractMatchCodeFromUrl('https://drafter.uma.guide/join/6XN84X'),'6XN84X');
  assert.equal(c.extractMatchCodeFromUrl('https://drafter.uma.guide/host'),undefined);
  assert.equal(c.normalizeMatchCode('Room 6XN84X secret'),undefined);
});

function domHarness(body) {
  const {document,HTMLElement}=parseHTML('<html><body>'+body+'</body></html>');
  HTMLElement.prototype.getBoundingClientRect=function(){return {top:0,left:Number(this.getAttribute('data-left')??0)};};
  const c=context({document});evaluate(c,'utils/matchDetection.ts');evaluate(c,'utils/textCleanup.ts');evaluate(c,'utils/domLobbyExtraction.ts');
  return {c,document};
}
const realTrainerRow=(name='CLUE | 기',avatar='https://cdn.discordapp.com/avatars/634868914484019202/avatar.png')=>`<div data-trainer-player="true"><span class="trainer-companion"><img alt="Fine Motion companion" src="/uma/1001.png"></span><button data-trainer-trigger="true" aria-label="View ${name}'s trainer card"><img alt="${name}" src="${avatar}"></button><div><button data-trainer-trigger="true">${name}</button></div><span>Captain</span><span>Host</span></div>`;
const lobbyFixture=(left,right)=>`<button title="Copy room code" aria-label="Copy room code">6XN-84X</button><section data-left="0"><h2>Team 1[edit]</h2>${left}</section><section data-left="400"><h2>Team 2</h2>${right}</section>`;

test('real trainer buttons beat companion images, and room codes exist before draft',()=>{
  const {c,document}=domHarness(lobbyFixture(realTrainerRow(),'<p>Waiting for player...</p>'));
  const roster=c.extractPrematchRosterFromRoomDom(document);
  assert.equal(roster.matchCode,'6XN84X');assert.equal(roster.players.length,1);
  assert.equal(roster.players[0].displayName,'CLUE | 기');assert.equal(roster.players[0].discordId,'634868914484019202');
  assert.equal(roster.teams.team1.name,'Team 1');assert.equal(roster.teams.team2.players.length,0);
});

test('empty first team does not renumber Team 2; unrelated pages are not lobbies',()=>{
  const {c,document}=domHarness(lobbyFixture('<p>Waiting for player...</p>',realTrainerRow()));
  assert.equal(c.extractPrematchRosterFromRoomDom(document).players[0].team,'team2');
  const other=domHarness('<h2>Leaderboard</h2><p>Some players</p>');assert.equal(other.c.extractPrematchRosterFromRoomDom(other.document),null);
});

test('default avatar cannot invent an ID; a verified profile link supplies it',()=>{
  const row=realTrainerRow('Guest','https://cdn.discordapp.com/embed/avatars/0.png');
  const first=domHarness(lobbyFixture(row,'<p>Waiting for player...</p>'));
  const player=first.c.extractPrematchRosterFromRoomDom(first.document).players[0];
  assert.equal(player.displayName,'Guest');assert.equal(player.profileLookupUnavailable,true);
  const linked=domHarness(lobbyFixture(row.replace('</div><span>Captain','<a href="/players/634868914484019202">Profile</a></div><span>Captain'),'<p>Waiting for player...</p>'));
  assert.equal(linked.c.extractPrematchRosterFromRoomDom(linked.document).players[0].discordId,'634868914484019202');
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
  const {state,c}=roomHarness();const event=matchEvent({phase:'complete',rules:{map:{picksPerTeam:3},uma:{teamSize:5,preBansPerTeam:0,postBansPerTeam:0}}});
  event.state.team1.pickedUmas=[{id:'100101',name:'Outfit A'}];
  event.state.availableUmas=[{id:'100102',name:'Not picked'}];event.state.draftActionHistory=[{uma:{id:'100103',name:'Undone'}}];
  event.state.pendingSelection={uma:{id:'100104',name:'Preview'}};
  const clean=c.decodeRoomEvent('42'+JSON.stringify(['server:event',event]));
  const result=state.apply(clean,'M95Z2Z');assert.equal(result.draft.teams.team1.umas.length,1);assert.equal(result.draft.rules.picks,5);assert.equal(result.draft.rules.bans,0);
  const undo=matchEvent({phase:'uma-pick',version:2});state.apply(undo,'M95Z2Z');
  assert.equal(state.draft.phase,'uma-pick');assert.equal(state.draft.teams.team1.umas.length,0);
  assert.equal(state.apply(event,'M95Z2Z').reason,'old-version');
});

test('event decoding ignores chat and removes unrelated sensitive fields',()=>{
  const {c}=roomHarness();assert.equal(c.decodeRoomEvent(['room:chat',{participants:players()}]),null);
  const event=matchEvent();event.assignmentToken='SECRET';event.state.multiplayer.assignmentToken='SECRET';event.state.chatMessages=['SECRET'];
  assert(!JSON.stringify(c.decodeRoomEvent(event)).includes('SECRET'));
  assert.equal(c.decodeRoomEvent('x'.repeat(2_000_001)),null);
});

test('selected stats scope reduces ten-player cold request count from 32 to 22',async()=>{
  for(const scope of ['currentSeason','allTime']){
    const h=apiHarness();const summaries=await h.c.fetchPlayerProfileSummaries(players(10),{scope});
    assert.equal(h.calls.length,22);assert.equal(Object.keys(summaries).length,10);
    const statCalls=h.calls.filter(p=>p.includes('/stats?'));
    assert.equal(statCalls.length,10);assert(statCalls.every(p=>p.includes('&season=')===(scope==='currentSeason')));
    assert(Object.values(summaries).every(p=>p.scopeFetchedAt[scope]>0 && p.error===undefined));
  }
});

test('selected-scope public requests never reconstruct private stats',async()=>{
  for(const privateBuild of [false,true]){
    const h=apiHarness({privateBuild,responder:url=>url.pathname.endsWith('/stats')?{status:403}:undefined});
    await h.c.fetchPlayerProfileSummaries(players(1),{scope:'allTime'});
    assert.equal(h.calls.filter(p=>p.includes('/history?')).length,0);
    assert(!h.calls.some(p=>p.includes('&season=')));
  }
});

test('scope merge retains timestamps, and an unfetched scope is not considered fresh',()=>{
  const h=backgroundHarness();const p={discordId:players(1)[0].discordId,fetchedAt:h.now,error:undefined,bestUmaScoreVersion:17,recentHistoryVersion:6,
    currentSeasonStats:{allUmas:[],recentHistoryVersion:6},allTimeStats:{allUmas:[],matches:4,recentHistoryVersion:6},scopeFetchedAt:{allTime:h.now}};
  assert.equal(Object.keys(h.c.getFreshProfiles({[p.discordId]:p},[p.discordId],h.now)).length,0);
  const merged=h.c.mergeProfileScopes(p,{...p,scopeFetchedAt:{currentSeason:h.now+100},allTimeStats:{allUmas:[]}});
  assert.equal(merged.allTimeStats.matches,4);assert.equal(merged.scopeFetchedAt.allTime,h.now);
  assert.equal(merged.scopeFetchedAt.currentSeason,h.now+100);
});

test('recorder caps the trace and never stores arbitrary payloads, identifiers, or tokens',async()=>{
  const stored={};const c=context({browser:{storage:{local:{get:async()=>({}),set:async value=>Object.assign(stored,value)}}}});
  evaluate(c,'utils/diagnosticRecorder.ts');
  const clean=c.sanitizeDiagnostic({kind:'room',reason:'match-snapshot',room:'M95Z2Z',team1:5,token:'SECRET',payload:{chat:'SECRET'},discordId:'SECRET',endpoint:'SECRET',phase:'SECRET'});
  assert(!JSON.stringify(clean).includes('SECRET'));
  for(let i=0;i<250;i++)c.recordDiagnostic({kind:'room',reason:'match-snapshot',version:i,team1:5,team2:5});
  const trace=await c.getDiagnosticTrace();assert.equal(trace.length,200);assert.equal(trace[0].version,50);assert.equal(trace.at(-1).version,249);
});

function contentRoomHarness({delayDraft}={}) {
  let visibleRoom;let domRoster=null;const sent=[];
  const c=context({cleanTeamName:x=>x,getUmaDisplayName:(id,name)=>name??id,normalizeUmaOutfitId:x=>x,
    document:{},window:{location:{href:'https://drafter.uma.guide/host'},clearTimeout},
    extractRoomCodeFromRoomDom:()=>visibleRoom,extractPrematchRosterFromRoomDom:()=>domRoster,
    extractDraftSnapshotFromDraftDom:()=>null,extractDraftSnapshotFromSyncedDraftState:()=>null,
    sendDraftSnapshot:async()=>{if(delayDraft)await delayDraft.promise;},sendPrematchRoster:async roster=>sent.push(structuredClone(roster))});
  evaluate(c,'utils/matchDetection.ts');evaluate(c,'utils/syncPayload.ts');evaluate(c,'utils/playerExtraction.ts');evaluate(c,'entrypoints/content.ts');
  const send=event=>c.handleWindowMessage({type:'umalytics:room-event',hookVersion:4,payload:event});
  return {c,sent,send,show(room,roster){visibleRoom=room;domRoster=roster;}};
}

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

test('scope switch cancels old work and passes the new scope through the background loader',async()=>{
  const h=backgroundHarness();const first=h.c.enrichRosterProfiles(roster());await tick();
  assert.equal(h.fetches[0].options.scope,'currentSeason');
  vm.runInContext("selectedStatsScope = 'allTime'",h.c);
  const second=h.c.enrichRosterProfiles(roster());await tick();
  assert.equal(h.fetches.length,2);assert.equal(h.fetches[0].options.signal.aborted,true);assert.equal(h.fetches[1].options.scope,'allTime');
  h.fetches[0].gate.resolve();h.fetches[1].gate.resolve();await Promise.all([first,second]);
});

test('page hook forwards typed frames but does not promote arbitrary player arrays',()=>{
  const {c}=roomHarness();const messages=[];
  Object.assign(c,{Blob,ArrayBuffer,TextDecoder,defineUnlistedScript:()=>{},window:{location:{origin:'https://drafter.uma.guide'},postMessage:message=>messages.push(message)}});
  evaluate(c,'entrypoints/pageHook.ts');
  c.inspectPossiblePayload('42'+JSON.stringify(['server:event',matchEvent()]),'websocket','M95Z2Z');
  c.inspectPossiblePayload({roomCode:'M95Z2Z',players:players(2)},'websocket','M95Z2Z');
  c.inspectPossiblePayload({roomCode:'M95Z2Z',players:players(2)},'storage','M95Z2Z');
  assert.equal(messages.length,1);assert.equal(messages[0].type,'umalytics:room-event');assert.equal(messages[0].hookVersion,4);
});

test('unknown and private experience are never labelled as zero games',()=>{
  const c=context();evaluate(c,'utils/profileAvailability.ts');
  assert.equal(c.missingUmaHistoryLabel(undefined,'allTime'),'Stats not loaded yet');
  assert.equal(c.missingUmaHistoryLabel({scopeFetchedAt:{currentSeason:1}},'allTime'),'Stats not loaded for this scope');
  assert.equal(c.missingUmaHistoryLabel({statsPrivate:true},'allTime'),'Stats are private');
  assert.equal(c.missingUmaHistoryLabel({historyDerived:true},'allTime'),'No games in available history sample');
  assert.equal(c.missingUmaHistoryLabel({},'allTime'),'No recorded games');
});

test('an explicit team assignment moves a player instead of leaving duplicate identities',()=>{
  const {state}=roomHarness();state.apply(matchEvent(),'M95Z2Z');
  state.apply({type:'participant.uma-assignments.snapshot',matchId:'M95Z2Z',team:'team2',revision:1,roster:[{...players(1)[0],team:'team2'}]},'M95Z2Z');
  assert.equal(state.roster.teams.team1.players.length,4);assert.equal(state.roster.teams.team2.players.length,1);
  assert.equal(new Set(state.roster.players.map(p=>p.discordId)).size,state.roster.players.length);
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

test('stats age uses the selected scope, never a room publication timestamp',()=>{
  const c=context(); evaluate(c,'utils/profileConstants.ts'); evaluate(c,'utils/profileTiming.ts');
  const snapshot={updatedAt:999_999,profiles:{a:{fetchedAt:1200,scopeFetchedAt:{currentSeason:1000,allTime:500}},b:{fetchedAt:1100,scopeFetchedAt:{currentSeason:900}}}};
  assert.equal(c.latestStatsCheckAt(snapshot,'currentSeason'),1000);
  assert.equal(c.latestStatsCheckAt(snapshot,'allTime'),500);
  assert.equal(c.latestStatsCheckAt({profiles:{a:snapshot.profiles.b}},'allTime'),undefined);
  assert.equal(c.getRefreshCooldownMs(undefined,999_999),0);
  assert(c.getRefreshCooldownMs(999_990,999_999)>0);
  assert.equal(c.getRefreshCooldownMs(999_990,1_100_000),0);
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

test('confirmed maps use the drafter combined order and preserve distinct course identities',()=>{
  const {state}=roomHarness(); const event=matchEvent();
  for(const team of ['team1','team2']) event.state[team].pickedMaps=[1,2,3].map(n=>({id:`${team}-${n}`,track:'Nakayama',distance:2000+n*100}));
  event.state.team1.bannedMaps=[{id:'veto',track:'Nakayama',distance:2500}];
  const {draft}=state.apply(event,'M95Z2Z');
  assert.deepEqual(Array.from(draft.teams.team1.maps,m=>m.order),[1,3,5,undefined]);
  assert.deepEqual(Array.from(draft.teams.team2.maps,m=>m.order),[2,4,6]);
  assert.equal(new Set(draft.teams.team1.maps.map(m=>m.mapId)).size,4);
});

test('page hook startup never reads site localStorage or sessionStorage',()=>{
  const w={location:{origin:'https://drafter.uma.guide'},console:{debug(){},log(){},info(){}},WebSocket:class {addEventListener(){} }};
  Object.defineProperties(w,{localStorage:{get(){throw new Error('Unexpected storage read');}},sessionStorage:{get(){throw new Error('Unexpected storage read');}}});
  const c=context({window:w,defineUnlistedScript:fn=>fn()}); evaluate(c,'entrypoints/pageHook.ts');
});

test('DOM fallback preserves visible combined map numbers and leaves vetoes unnumbered',()=>{
  const {document}=parseHTML('<section><button aria-label="Open Nakayama 2000m map helper"><div>3</div><div>Nakayama</div><div>2000m Turf</div></button><button aria-label="Open Hanshin 2200m map helper"><span class="line-through">Hanshin</span>\n2200m Turf</button></section>');
  const c=context();evaluate(c,'utils/draftExtraction.ts');
  const maps=c.extractDomMaps('team1',document.querySelector('section'));
  assert.equal(maps[0].order,3);assert.equal(maps[1].order,undefined);assert.equal(maps[1].status,'vetoed');
});
