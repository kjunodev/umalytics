import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { deferred, sleep, waitUntil, players, apiHarness } from './support/helpers.mjs';

test('stats requests start while shared setup is pending; no HTML/assets requested',async()=>{
  const h=apiHarness({responder:url=>url.pathname==='/api/seasons'?{hang:true}:undefined});
  let starts=0;
  const pending=h.c.fetchPlayerProfileSummaries(players(),{onStart:()=>{starts++;}});
  await waitUntil(()=>starts===5 && h.calls.some(p=>p.includes('/stats?')));
  assert.equal(starts,5);
  assert(h.calls.some(p=>p.includes('/stats?')),JSON.stringify(h.calls));
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
  assert.equal(h.calls.length,22);
});

test('seasonal stats arrive before a stalled leaderboard',async()=>{
  const h=apiHarness({responder:url=>url.pathname==='/api/leaderboard'?{hang:true}:undefined});
  const ready=deferred();let finished=false;
  const pending=h.c.fetchPlayerProfileSummaries(players(1),{scope:'currentSeason',onProgress:summary=>{
    if(summary.currentSeasonStats.matches===4) ready.resolve(summary);
  }}).then(value=>{finished=true;return value;});
  const partial=await Promise.race([ready.promise,sleep(150).then(()=>{throw new Error('Season stats waited for leaderboard');})]);
  assert.equal(partial.isPartial,true);assert.equal(finished,false);
  await pending;
});

test('identical in-flight profile requests share one fetch and one caller can cancel',async()=>{
  const h=apiHarness({latency:30});const first=new AbortController();const second=new AbortController();
  const path=`/api/stats/players/${players(1)[0].discordId}/profile`;
  const a=h.c.fetchJson(path,first.signal,'profile');
  const b=h.c.fetchJson(path,second.signal,'profile');
  await waitUntil(()=>h.calls.filter(call=>call===path).length===1);
  first.abort(new Error('Switched rooms'));
  await assert.rejects(a,/Switched rooms/);
  assert.equal((await b).displayName,'Fixture');
  assert.equal(h.calls.filter(call=>call===path).length,1);
  assert.equal(h.aborts,0);
});

test('last consumer cancellation removes the shared request before an immediate retry',async()=>{
  let started=0;
  const h=apiHarness({latency:30,responder:()=>++started===1?{hang:true}:undefined});
  const path=`/api/stats/players/${players(1)[0].discordId}/profile`;
  const first=new AbortController();
  const a=h.c.fetchJson(path,first.signal,'profile');
  await waitUntil(()=>h.calls.length===1);
  first.abort(new Error('Switched rooms'));
  const b=h.c.fetchJson(path,undefined,'profile');
  await assert.rejects(a,/Switched rooms/);
  const c=h.c.fetchJson(path,undefined,'profile');
  assert.equal((await b).displayName,'Fixture');
  assert.equal((await c).displayName,'Fixture');
  assert.equal(h.calls.length,2);
});

test('session writes coalesce recent responses into one latest snapshot',async()=>{
  const saved={};let writes=0;
  const sessionStorage={get:async()=>({}),set:async values=>{writes++;Object.assign(saved,structuredClone(values));}};
  const h=apiHarness({sessionStorage,latency:0});
  await Promise.all(players(6).map(player=>h.c.fetchJson(`/api/stats/players/${player.discordId}/profile`,undefined,'profile')));
  await waitUntil(()=>writes===1);
  assert.equal(Object.keys(saved.profileApiResponsesV1).length,6);
  await sleep(270);
  assert.equal(writes,1);
});

test('session response cache survives restart and obeys 10-minute and 24-hour TTLs',async()=>{
  const saved={};const sessionStorage={
    get:async key=>({[key]:structuredClone(saved[key])}),
    set:async values=>Object.assign(saved,structuredClone(values))
  };
  let now=Date.now();class Clock extends Date {static now(){return now;}}
  const paths=['/api/seasons','/api/leaderboard?season=S1',`/api/stats/players/${players(1)[0].discordId}/profile`];
  const fetchAll=async h=>{h.c.Date=Clock;await Promise.all(paths.map(path=>h.c.fetchJson(path)));};
  const first=apiHarness({sessionStorage});await fetchAll(first);assert.equal(first.calls.length,3);
  await waitUntil(()=>Object.keys(saved.profileApiResponsesV1??{}).length===3);
  const restarted=apiHarness({sessionStorage});await fetchAll(restarted);assert.equal(restarted.calls.length,0);
  now+=10*60*1000+1;
  const staleShared=apiHarness({sessionStorage});await fetchAll(staleShared);
  assert.equal(staleShared.calls.length,2);assert(!staleShared.calls.some(path=>path.endsWith('/profile')));
  now+=24*60*60*1000;
  const staleProfile=apiHarness({sessionStorage});staleProfile.c.Date=Clock;
  await staleProfile.c.fetchJson(paths[2]);assert.equal(staleProfile.calls.length,1);
});

test('session response cache bounds profile entries',async()=>{
  const saved={};const sessionStorage={get:async key=>({[key]:saved[key]}),set:async values=>Object.assign(saved,values)};
  const h=apiHarness({sessionStorage,latency:0,fast:false});
  vm.runInContext('requestQueue.setStartInterval(0)',h.c);
  await Promise.all(Array.from({length:205},(_,i)=>h.c.fetchJson(`/api/stats/players/${String(100000000000000000n+BigInt(i))}/profile`,undefined,'profile')));
  await waitUntil(()=>Object.keys(saved.profileApiResponsesV1??{}).length===200);
  const cache=saved.profileApiResponsesV1;
  assert(Object.keys(cache).filter(path=>path.endsWith('/profile')).length<=200);
});

test('session storage failure falls back to memory and cache diagnostics name the endpoint',async()=>{
  const sessionStorage={get:async()=>{throw new Error('Unavailable');},set:async()=>{throw new Error('Unavailable');}};
  const h=apiHarness({sessionStorage});const path=`/api/stats/players/${players(1)[0].discordId}/profile`;
  await h.c.fetchJson(path);await h.c.fetchJson(path);
  assert.equal(h.calls.length,1);
  assert(h.diagnostics.some(entry=>entry.kind==='cache' && entry.endpoint==='profile'));
  assert(h.diagnostics.every(entry=>entry.endpoint!==undefined));
});

test('an explicit endpoint label overrides the dynamic last path segment in diagnostics, so per-match-code paths still aggregate under one label',async()=>{
  const h=apiHarness();
  await h.c.fetchJson('/api/matches/FX1A2B',undefined,'background','match');
  await h.c.fetchJson('/api/matches/QZ9K3M',undefined,'background','match');
  assert(h.diagnostics.every(entry=>entry.endpoint==='match'));
  assert(!h.diagnostics.some(entry=>entry.endpoint==='FX1A2B' || entry.endpoint==='QZ9K3M'));
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
  await waitUntil(()=>h.calls.some(path=>path.includes('/players/')));
  controller.abort(new Error('Switched rooms'));
  await assert.rejects(pending,/Switched rooms/);
  await waitUntil(()=>h.aborts>0);
  assert.equal(summaries,0);
});

test('hidden stats never trigger history reconstruction',async()=>{
  const h=apiHarness({responder:url=>url.pathname.endsWith('/stats')?{status:403}:undefined});
  const result=await h.c.fetchPlayerProfileSummaries(players(1));
  assert.equal(h.calls.filter(p=>p.includes('/history')).length,0);
  assert.equal(Object.values(result)[0].statsPrivate,true);
});

test('API failure cannot relabel all-time results as current-season results',async()=>{
  const h=apiHarness({responder:url=>url.pathname==='/api/seasons'?{status:404}:undefined});
  const result=Object.values(await h.c.fetchPlayerProfileSummaries(players(1)))[0];
  assert.equal(result.allTimeStats.matches,4);assert.equal(result.currentSeasonStats.matches,null);
  assert.equal(result.currentSeasonStats.wins,null);assert(result.error);
});

test('initial all-time stats publish before a slow profile endpoint completes',async()=>{
  const h=apiHarness({responder:url=>url.pathname.endsWith('/profile')?{hang:true}:undefined});
  const usable=deferred();let finished=false;
  const pending=h.c.fetchPlayerProfileSummaries(players(1),{onProgress:p=>{if(p.allTimeStats.matches===4)usable.resolve(p);}}).then(result=>{finished=true;return result;});
  const first=await usable.promise;assert.equal(first.isPartial,true);assert.equal(finished,false);
  const result=Object.values(await pending)[0];assert.equal(result.allTimeStats.matches,4);
});

test('a cold 10-player lobby makes 12 requests, no profile/history/batch, and stats lead the leaderboard',async()=>{
  const h=apiHarness();
  const result=await h.c.fetchPlayerProfileSummaries(players(10),{scope:'currentSeason'});
  assert.equal(Object.keys(result).length,10);
  assert.equal(h.calls.length,12);
  assert.equal(h.calls.filter(p=>p.includes('/stats?')).length,10);
  assert.equal(h.calls.filter(p=>p==='/api/seasons').length,1);
  assert.equal(h.calls.filter(p=>p.startsWith('/api/leaderboard')).length,1);
  assert.equal(h.calls.filter(p=>p.endsWith('/profile')).length,0);
  assert.equal(h.calls.filter(p=>p.includes('/history?')).length,0);
  assert.equal(h.calls.filter(p=>p.includes('/batch?')).length,0);
  const leaderboardStart=h.callTimes[h.calls.findIndex(p=>p.startsWith('/api/leaderboard'))];
  const statStartTimes=h.calls.map((p,i)=>p.includes('/stats?')?h.callTimes[i]:undefined).filter(time=>time!==undefined);
  assert.equal(statStartTimes.length,10);
  assert(statStartTimes.every(time=>time<=leaderboardStart),'every stats request must start before the leaderboard request');
});

test('selected stats scope reduces ten-player cold request count from 22 to 12',async()=>{
  for(const scope of ['currentSeason','allTime']){
    const h=apiHarness();const summaries=await h.c.fetchPlayerProfileSummaries(players(10),{scope});
    assert.equal(h.calls.length,12);assert.equal(Object.keys(summaries).length,10);
    const statCalls=h.calls.filter(p=>p.includes('/stats?'));
    assert.equal(statCalls.length,10);assert(statCalls.every(p=>p.includes('&season=')===(scope==='currentSeason')));
    assert.equal(h.calls.filter(p=>p.endsWith('/profile')).length,0);
    assert(Object.values(summaries).every(p=>p.scopeFetchedAt[scope]>0 && p.error===undefined));
  }
});

test('selected-scope requests never reconstruct hidden stats',async()=>{
  const h=apiHarness({responder:url=>url.pathname.endsWith('/stats')?{status:403}:undefined});
  await h.c.fetchPlayerProfileSummaries(players(1),{scope:'allTime'});
  assert.equal(h.calls.filter(p=>p.includes('/history?')).length,0);
  assert(!h.calls.some(p=>p.includes('&season=')));
});

test('season leaderboard carries the active season display name from the one cached /api/seasons response',async()=>{
  const seasons=[{id:'S0',name:'Season 1 (Trackblazer)',active:false},{id:'S1',name:' Season 2 (Grand Concert) ',active:true}];
  const h=apiHarness({responder:url=>url.pathname==='/api/seasons'?{body:seasons}:url.pathname==='/api/leaderboard'?{body:{entries:[{userId:'1',rating:1834,rd:123}]}}:undefined});
  const board=await h.c.getSeasonLeaderboard(new AbortController().signal);
  assert.equal(board.activeSeasonId,'S1');
  assert.equal(board.activeSeasonName,'Season 2 (Grand Concert)');
  assert.deepEqual(h.calls,['/api/seasons','/api/leaderboard?season=S1'],'no extra requests to learn the season name');
});

test('season leaderboard omits the season name when /api/seasons has none, leaving the UI fallback to apply',async()=>{
  for (const body of [[{id:'S1',active:true}],[{id:'S1',name:'',active:true}],[{id:'S1',name:null,active:true}]]) {
    const h=apiHarness({responder:url=>url.pathname==='/api/seasons'?{body}:undefined});
    const board=await h.c.getSeasonLeaderboard(new AbortController().signal);
    assert.equal(board.activeSeasonId,'S1');
    assert.equal('activeSeasonName' in board,false);
  }
});
