import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, context, players, backgroundHarness } from './support/helpers.mjs';

test('profile archive excludes partial data and bounds age, count and byte size',()=>{
  const c=context();evaluate(c,'profileCache');const now=Date.now();
  const incoming=Object.fromEntries(Array.from({length:130},(_,i)=>[String(i),{discordId:String(i),fetchedAt:now-i,profileUrl:'fixture'}]));
  incoming.partial={discordId:'partial',fetchedAt:now,isPartial:true};
  incoming.old={discordId:'old',fetchedAt:now-25*60*60*1000};
  let result=c.mergeProfileCache({},incoming,now);assert.equal(Object.keys(result).length,100);
  assert.equal(result.partial,undefined);assert.equal(result.old,undefined);
  result=c.mergeProfileCache({},Object.fromEntries(Object.entries(incoming).map(([id,p])=>[id,{...p,title:'x'.repeat(100000)}])),now);
  assert(JSON.stringify(result).length*2<4*1024*1024);
  assert.equal(result['0'].fetchedAt,now,'reading the cache cannot extend freshness');
});

test('new cache keys do not restore older ranked-stat snapshots',async()=>{
  const stored={};const storage={get:async key=>({[key]:stored[key]}),set:async values=>Object.assign(stored,values)};
  function storageContext() {
    const c=context({browser:{storage:{local:storage}}});
    evaluate(c,'profileCache');evaluate(c,'profileStorage');return c;
  }
  stored['profileArchiveV1']={'1':{discordId:'1',fetchedAt:Date.now(),statsPrivate:true,matches:40}};
  stored['playerProfileSummaries']={profiles:stored['profileArchiveV1'],loadingDiscordIds:[]};
  const current=storageContext();
  assert.equal(Object.keys(await current.getCachedPlayerProfiles()).length,0);
  assert.equal(await current.getPlayerProfileSummaries(),undefined);
});

test('scope merge retains timestamps, and an unfetched scope is not considered fresh',()=>{
  const h=backgroundHarness();const p={discordId:players(1)[0].discordId,fetchedAt:h.now,error:undefined,bestUmaScoreVersion:17,recentHistoryVersion:6,
    currentSeasonStats:{allUmas:[],recentHistoryVersion:6},allTimeStats:{allUmas:[],matches:4,recentHistoryVersion:6},scopeFetchedAt:{allTime:h.now}};
  assert.equal(Object.keys(h.c.getFreshProfiles({[p.discordId]:p},[p.discordId],h.now)).length,0);
  const merged=h.c.mergeProfileScopes(p,{...p,scopeFetchedAt:{currentSeason:h.now+100},allTimeStats:{allUmas:[]}});
  assert.equal(merged.allTimeStats.matches,4);assert.equal(merged.scopeFetchedAt.allTime,h.now);
  assert.equal(merged.scopeFetchedAt.currentSeason,h.now+100);
});

test('stats age uses the selected scope, never a room publication timestamp',()=>{
  const c=context(); evaluate(c,'profileConstants'); evaluate(c,'profileTiming');
  const snapshot={updatedAt:999_999,profiles:{a:{fetchedAt:1200,scopeFetchedAt:{currentSeason:1000,allTime:500}},b:{fetchedAt:1100,scopeFetchedAt:{currentSeason:900}}}};
  assert.equal(c.latestStatsCheckAt(snapshot,'currentSeason'),1000);
  assert.equal(c.latestStatsCheckAt(snapshot,'allTime'),500);
  assert.equal(c.latestStatsCheckAt({profiles:{a:snapshot.profiles.b}},'allTime'),undefined);
  assert.equal(c.getRefreshCooldownMs(undefined,999_999),0);
  assert(c.getRefreshCooldownMs(999_990,999_999)>0);
  assert.equal(c.getRefreshCooldownMs(999_990,1_100_000),0);
});

test('unknown and private experience are never labelled as zero games',()=>{
  const c=context();evaluate(c,'profileAvailability');
  assert.equal(c.missingUmaHistoryLabel(undefined,'allTime'),'Stats not loaded yet');
  assert.equal(c.missingUmaHistoryLabel({scopeFetchedAt:{currentSeason:1}},'allTime'),'Stats not loaded for this scope');
  assert.equal(c.missingUmaHistoryLabel({statsPrivate:true},'allTime'),'Stats are private');
  assert.equal(c.missingUmaHistoryLabel({},'allTime'),'No recorded games');
});
