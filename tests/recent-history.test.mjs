import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModuleTS, loadFunction, parseTsxModule } from './support/harness.mjs';

const playerDetailSyntax = parseTsxModule('uiPlayerDetailScene');
const recentMatchesSyntax = parseTsxModule('uiPlayerRecentMatchesList');
const scoutDataSyntax = parseTsxModule('uiScoutData');
function harness(privateBuild = false) {
  const c = vm.createContext({ console, __UMALYTICS_PRIVATE_PROFILE_DATA__: privateBuild,
    useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useEffect: () => {},
    element: (type, props, ...children) => ({ type, props, children }),
    getLookupDiscordId: p => p.discordId, getPlayerNote: () => undefined, getStatsMessage: () => undefined,
    getNotableBadges: () => [], getPlayerPartyVisual: () => undefined, getTeamPartyVisuals: () => ({}),
    formatRank: () => '', formatRecord: () => '', formatPercent: () => '', formatDecimal: () => '', formatNumber: () => '',
    getRecentResultTone: () => 'win', formatRecentResult: () => 'W',
    ProfileDataStatus: 'Status', StatCell: 'Stat', TopUmasList: 'Umas', UmaResolutionNote: 'Note',
    ScoutingReport: 'Report', BestUmasList: 'Best', filterSnapshotForBuild: x => x,
    filterProfileStatesForDisplay: x => x, getLoadingDiscordIdsForDisplay: () => [],
  });
  for (const name of ['profileConstants', 'profileMerge', 'profileCache', 'explorerState']) {
    loadModuleTS(c, name);
  }
  loadFunction(c, playerDetailSyntax, 'getDisplayedProfileStats');
  loadFunction(c, playerDetailSyntax, 'PlayerDetailScene');
  loadFunction(c, recentMatchesSyntax, 'RecentMatchesList');
  loadFunction(c, scoutDataSyntax, 'isDisplayableStoredProfile');
  loadFunction(c, scoutDataSyntax, 'normalizeProfileSnapshotForDisplay');
  return c;
}
const entry = {matchId:'FIX001',reportedAt:'2026-09-18T12:00:00Z',mode:'ranked',verificationState:'confirmed',umaId:null,umaName:'Unknown Uma',isWinner:true,pointsScored:3,podiums:1,isMvp:false};
function profile(scope = 'allTime', matches = [entry]) {
  const stats = {matches:matches.length,recentMatches:matches,recentHistoryStatus:'loaded',recentHistoryVersion:6};
  return {discordId:'123456789012345678',displayName:'Fixture',profileUrl:'',fetchedAt:Date.now(),activeSeasonId:'S1',statsScope:scope,
    scopeFetchedAt:{[scope]:Date.now()},bestUmaScoreVersion:17,recentHistoryVersion:6,...stats,
    allTimeStats:scope==='allTime'?stats:{recentMatches:[],recentHistoryVersion:6},
    currentSeasonStats:scope==='currentSeason'?stats:{recentMatches:[],recentHistoryVersion:6}};
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of (node.children ?? []).flat(Infinity)) { const result = find(child,predicate); if(result)return result; }
}
function renderedRecent(c,p,scope) {
  const normalized=c.normalizeProfileSnapshotForDisplay({profiles:{[p.discordId]:p},loadingDiscordIds:[],updatedAt:Date.now()}).profiles[p.discordId];
  const details=c.PlayerDetailScene({player:{discordId:p.discordId,displayName:'Fixture'},profile:normalized,statsScope:scope,isProfileLoading:false,now:Date.now(),onBack(){}});
  const recent=find(details,n=>n.type===c.RecentMatchesList);
  assert(recent, 'Details contains the real RecentMatchesList');
  return c.RecentMatchesList(recent.props);
}

test('non-empty history survives snapshot normalization and reaches Details and its actual match links',()=>{
  const c=harness(true), p=profile();
  const rendered=renderedRecent(c,p,'allTime');
  assert(find(rendered,n=>n.type==='a' && n.props.href.endsWith('/FIX001')));
  assert(JSON.stringify(rendered).includes('Unknown Uma'));
});
test('scope changes retain history through both the cache and player lookup, including private reconstruction',()=>{
  for (const privateBuild of [false,true]) {
    const c=harness(privateBuild), old={...profile(),statsPrivate:privateBuild,historyDerived:privateBuild};
    const next={...profile('currentSeason',[{...entry,matchId:'NEW001'}]),statsPrivate:privateBuild,historyDerived:privateBuild};
    for (const merged of [c.mergeProfileCache({[old.discordId]:old},{[old.discordId]:next},Date.now())[old.discordId],c.mergeExplorerProfiles({[old.discordId]:old},{[old.discordId]:next})[old.discordId]]) {
      assert.equal(c.getDisplayedProfileStats(merged,'allTime').recentMatches[0].matchId,'FIX001');
      assert.equal(c.getDisplayedProfileStats(merged,'currentSeason').recentMatches[0].matchId,'NEW001');
      assert(find(renderedRecent(c,merged,'allTime'),n=>n.type==='a'));
    }
  }
});
test('partial and failed history updates preserve loaded history, but completed empty responses clear it',()=>{
  const c=harness(true), old=profile();
  for (const status of ['loading','unavailable']) {
    const next=profile('allTime',[]); next.allTimeStats.recentHistoryStatus=status;
    next.isPartial=status==='loading';
    const merged=c.mergeProfileScopes(old,next);
    assert.equal(merged.allTimeStats.recentMatches.length,1);
    assert.equal(c.mergeExplorerProfiles({[old.discordId]:old},{[old.discordId]:next})[old.discordId].recentMatches.length,1);
    assert.equal(c.mergeProfileCache({[old.discordId]:old},{[old.discordId]:next},Date.now())[old.discordId].recentMatches.length,1);
  }
  const empty=c.mergeProfileScopes(old,profile('allTime',[]));
  assert.equal(empty.recentMatches.length,0);
  assert(JSON.stringify(renderedRecent(c,empty,'allTime')).includes('No recent match history found.'));
});
test('privacy denial clears history and unavailable history never claims a genuinely empty response',()=>{
  const old=profile();
  const denied={...profile('allTime',[]),statsPrivate:true,recentHistoryStatus:'private'}; denied.allTimeStats.recentHistoryStatus='private';
  for (const privateBuild of [false,true]) {
    const c=harness(privateBuild), result=c.mergeProfileScopes(old,denied);
    assert.equal(result.recentMatches.length,0);
    assert.equal(c.recentHistoryEmptyMessage(result),'Match history is private.');
  }
  const c=harness(), unavailable=profile('allTime',[]);unavailable.recentHistoryStatus='unavailable';
  assert.match(c.recentHistoryEmptyMessage(unavailable),/unavailable/);
});
test('new season and another player cannot inherit previous scoped history; paged matches remain visible',()=>{
  const c=harness(), old=profile('currentSeason');
  const next={...profile(),activeSeasonId:'S2'};
  assert.equal(c.getDisplayedProfileStats(c.mergeProfileScopes(old,next),'currentSeason').recentMatches.length,0);
  const other={...profile('currentSeason',[]),discordId:'987654321098765432'};
  assert.equal(c.mergeProfileScopes(old,other).recentMatches.length,0);
  const many=profile('allTime',Array.from({length:8},(_,i)=>({...entry,matchId:`FIX00${i}`})));
  const list=find(renderedRecent(c,many,'allTime'),n=>n.type==='ol');
  assert.equal(list.children.flat().length,8);
});

test('an early partial response awaiting season metadata cannot invalidate cached season history',()=>{
  const c=harness(), old=profile('currentSeason');
  const pending={...profile('allTime',[]),activeSeasonId:undefined,isPartial:true};
  const merged=c.mergeProfileScopes(old,pending);
  assert.equal(merged.activeSeasonId,'S1');
  assert.equal(c.getDisplayedProfileStats(merged,'currentSeason').recentMatches[0].matchId,'FIX001');
});

test('history privacy denial also invalidates cached history in the unrequested scope',()=>{
  const c=harness(true), old=profile('currentSeason');
  const next=profile('allTime',[]); next.allTimeStats.recentHistoryStatus='private'; next.recentHistoryStatus='private'; next.statsPrivate=true;
  const result=c.mergeProfileScopes(old,next);
  assert.equal(c.getDisplayedProfileStats(result,'currentSeason').recentMatches.length,0);
  assert.equal(result.scopeFetchedAt.currentSeason,undefined);
  assert.equal(c.mergeProfileCache({[old.discordId]:old},{[old.discordId]:next},Date.now())[old.discordId].currentSeasonStats.recentMatches.length,0);
});

test('history transport status takes precedence over stats privacy while reconstructing a private profile',()=>{
  const c=harness(true);
  for (const [status,message] of [['loading','Loading recent match history.'],['unavailable','Recent match history is unavailable for this scope.'],['loaded','No recent match history found.'],['private','Match history is private.']]) {
    assert.equal(c.recentHistoryEmptyMessage({...profile('allTime',[]),statsPrivate:true,historyDerived:false,recentHistoryStatus:status}),message);
  }
  assert.equal(c.recentHistoryEmptyMessage(c.getDisplayedProfileStats(profile(),'currentSeason')),'Recent match history is unavailable for this scope.');
});

test('legacy team caches stay displayable but must refresh missing history state once',()=>{
  const old=profile();delete old.allTimeStats.recentHistoryStatus;
  const c=harness(true);
  assert.equal(c.hasCurrentHistoryState(old,'allTime'),false);
  assert.equal(c.getDisplayedProfileStats(old,'allTime').recentMatches.length,1);
  assert.equal(c.hasCurrentHistoryState(profile(),'allTime'),true);
  assert.equal(harness(false).hasCurrentHistoryState(old,'allTime'),true);
});

test('opening details requests page one, Load more requests page two, and closing cancels pending work',async()=>{
  const c=harness();
  let state, ref, effect, nextId=0;
  const requests=[], cancelled=[];
  c.crypto={randomUUID:()=>`fixture-request-${++nextId}`};
  c.useState=initial=>[state??=initial,update=>{state=typeof update==='function'?update(state):update;}];
  c.useRef=initial=>ref??={current:initial};
  c.useEffect=callback=>{effect=callback;};
  c.sendPlayerHistoryPageRequest=(id,scope,page,requestId)=>{
    requests.push({id,scope,page,requestId});
    return page===1 ? Promise.resolve({page,total:21,matches:[entry]}) : new Promise(()=>{});
  };
  c.cancelPlayerHistoryPageRequest=async requestId=>{cancelled.push(requestId);};
  const p=profile(), player={discordId:p.discordId,displayName:'Fixture'};
  const render=()=>c.PlayerDetailScene({player,profile:p,statsScope:'allTime',isProfileLoading:false,now:Date.now(),onBack(){}});
  render();
  const close=effect();
  await new Promise(resolve=>setImmediate(resolve));
  const recent=find(render(),node=>node.type===c.RecentMatchesList);
  assert.equal(requests[0].page,1);
  assert.equal(recent.props.recentMatches.length,1);
  recent.props.onLoadMore();
  assert.equal(requests[1].page,2);
  close();
  assert.deepEqual(cancelled,[requests[1].requestId]);
});
