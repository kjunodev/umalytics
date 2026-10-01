import test from 'node:test';
import assert from 'node:assert/strict';
import { tick, players, roster, apiHarness, backgroundHarness } from './support/helpers.mjs';

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
