import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { evaluate, deferred, waitUntil, context, players, apiHarness } from './support/helpers.mjs';

test('at the 350 ms pace, 10-player stats resolve within ~4 s and the whole lobby within ~4.5 s',async()=>{
  const h=apiHarness({latency:100,fast:false});const resolved=new Map();const start=performance.now();
  await h.c.fetchPlayerProfileSummaries(players(10),{scope:'currentSeason',onProgress:summary=>{
    if(summary.currentSeasonStats.matches===4 && !resolved.has(summary.discordId)) resolved.set(summary.discordId,performance.now()-start);
  }});
  const lobbyMs=performance.now()-start;
  const times=[...resolved.values()];
  assert.equal(times.length,10);assert(Math.min(...times)<1200);
  assert(Math.max(...times)<4000,`stats should resolve within ~4s, took ${Math.max(...times)}ms`);
  assert(lobbyMs<4500,`the whole lobby should resolve within ~4.5s, took ${lobbyMs}ms`);
  assert(h.callTimes.slice(1).every((time,i)=>time-h.callTimes[i]>=300));
});

test('slow session storage does not occupy queue slots or delay paced starts',async()=>{
  const gate=deferred();let writes=0;
  const sessionStorage={get:async()=>({}),set:async()=>{writes++;await gate.promise;}};
  const h=apiHarness({sessionStorage,latency:5,fast:false});
  const paths=players(4).map(player=>`/api/stats/players/${player.discordId}/profile`);
  const pending=Promise.all(paths.map(path=>h.c.fetchJson(path,undefined,'profile')));
  try {
    await waitUntil(()=>h.calls.length===4,2500);
    await pending;
    assert(writes>=1);
    assert(h.callTimes.slice(1).every((time,i)=>time-h.callTimes[i]>=300));
  } finally { gate.resolve(); }
});

test('rate limits fail explicitly without sleeping or issuing a retry storm',async()=>{
  const h=apiHarness({responder:url=>url.pathname==='/api/seasons'?{status:429,headers:{'retry-after':'30'}}:undefined});
  const start=performance.now(); const result=await h.c.fetchPlayerProfileSummaries(players(10));
  assert(performance.now()-start<500);
  assert(Object.values(result).every(p=>p.error!==undefined));
  assert(h.calls.length<=6);
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
  const seasonCallsBefore=h.calls.filter(p=>p==='/api/seasons').length;
  failing=false;clock=cooldown.until;
  const result=Object.values(await h.c.fetchPlayerProfileSummaries(players(1)))[0];
  assert.equal(result.error,undefined);assert.equal(result.allTimeStats.matches,4);
  assert.equal(h.calls.filter(p=>p==='/api/seasons').length,seasonCallsBefore,'successful shared endpoint reused, unaffected by the stats cooldown');
});

test('HTTP date Retry-After and server failures preserve their recovery deadline',async()=>{
  let clock=Date.now();class Clock extends Date {static now(){return clock;}}
  for(const status of [429,503]) {
    const until=Math.ceil((clock+90000)/1000)*1000;
    const h=apiHarness({responder:()=>({status,headers:{'retry-after':new Date(until).toUTCString()}})});
    h.c.Date=Clock;
    await h.c.fetchPlayerProfileSummaries(players(1));
    assert.equal(h.c.getApiCooldown().until,until);assert.equal(h.c.getApiCooldown().status,status);
  }
});

test('request pacing spaces start times and cancellation does not dispatch abandoned jobs',async()=>{
  const c=context();evaluate(c,'requestQueue');const queue=vm.runInContext('new RequestQueue(3, 30)',c);
  const starts=[];const controller=new AbortController();
  await Promise.all(Array.from({length:4},()=>queue.run(controller.signal,async()=>{starts.push(performance.now());})));
  assert(starts.slice(1).every((time,i)=>time-starts[i]>=27),JSON.stringify(starts));
  const aborter=new AbortController();let called=false;
  const abandoned=queue.run(aborter.signal,async()=>{called=true;});aborter.abort(new Error('Room changed'));
  await assert.rejects(abandoned,/Room changed/);assert.equal(called,false);
});

test('paced starts choose priority first and retain FIFO within each priority',async()=>{
  const c=context();evaluate(c,'requestQueue');const queue=vm.runInContext('new RequestQueue(3, 30)',c);
  const signal=new AbortController().signal;const starts=[];
  const jobs=[['background','old'],['profile','profile'],['stats','stats-a'],['history','history'],['shared','shared'],['stats','stats-b'],['leaderboard','leaderboard']];
  await Promise.all(jobs.map(([priority,name])=>queue.run(signal,async()=>{starts.push([name,performance.now()]);},priority)));
  assert.deepEqual(starts.map(([name])=>name),['shared','stats-a','stats-b','leaderboard','profile','history','old']);
  assert(starts.slice(1).every(([,time],i)=>time-starts[i][1]>=27));
});

test('a 429 increases request spacing and the cooldown persists that spacing',async()=>{
  const h=apiHarness({responder:()=>({status:429})});const initial=vm.runInContext('requestStartIntervalMs',h.c);
  await h.c.fetchPlayerProfileSummaries(players(1));
  assert(h.c.getApiCooldown().startIntervalMs>initial);
  const next=apiHarness();next.c.restoreApiCooldown(h.c.getApiCooldown());
  assert.equal(vm.runInContext('requestStartIntervalMs',next.c),h.c.getApiCooldown().startIntervalMs);
});

test('pacing recovers toward the base interval after sustained success following a 429',async()=>{
  let clock=Date.now();class Clock extends Date {static now(){return clock;}}
  const h=apiHarness({responder:url=>url.pathname==='/api/seasons'?{status:429,headers:{'retry-after':'1'}}:undefined});
  h.c.Date=Clock;
  await h.c.fetchJson('/api/seasons',undefined,'shared').catch(()=>{});
  const afterBackoff=vm.runInContext('requestStartIntervalMs',h.c);
  const base=vm.runInContext('baseRequestIntervalMs',h.c);
  assert(afterBackoff>base,'a 429 must double the interval above the base');
  clock=h.c.getApiCooldown().until;
  for(let i=0;i<19;i++) await h.c.fetchJson(`/api/stats/players/${String(100000000000000000n+BigInt(i))}/profile`,undefined,'profile');
  assert.equal(vm.runInContext('requestStartIntervalMs',h.c),afterBackoff,'no recovery step before the 20th consecutive success');
  await h.c.fetchJson(`/api/stats/players/${String(100000000000000000n+BigInt(19))}/profile`,undefined,'profile');
  const afterRecovery=vm.runInContext('requestStartIntervalMs',h.c);
  assert.equal(afterRecovery,Math.max(base,afterBackoff*0.75),'the 20th consecutive success steps the interval back by 0.75x');
  assert(afterRecovery>=base,'recovery can never go below the base interval');
});
