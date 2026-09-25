import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModuleTS, loadFunction, parseTsxModule } from './support/harness.mjs';

const playerDisplaySyntax = parseTsxModule('uiPlayerProfileDisplay');
const playerDrawerSyntax = parseTsxModule('uiPlayerDrawer');
const teamSectionSyntax = parseTsxModule('uiLobbyTeamSection');
const recentMatchFormatSyntax = parseTsxModule('uiPlayerRecentMatchFormat');
const scoutDataSyntax = parseTsxModule('uiScoutData');
function harness(privateBuild = false) {
  const c = vm.createContext({ console, __UMALYTICS_PRIVATE_PROFILE_DATA__: privateBuild,
    useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useEffect: () => {},
    element: (type, props, ...children) => ({ type, props, children }),
    getLookupDiscordId: p => p.discordId, getPlayerNote: () => undefined, getStatsMessage: () => undefined,
    getNotableBadges: () => [], getPlayerPartyVisual: () => undefined, getTeamPartyVisuals: () => ({}),
    formatRank: () => '', formatRecord: () => '', formatPercent: () => '', formatDecimal: () => '', formatNumber: () => '',
    getRecentResultTone: () => 'win', formatRecentResult: () => 'W',
    ProfileDataStatus: 'Status', StatCell: 'Stat', BestUmaPortrait: 'Portrait', UmaImage: 'Image', EstimatedChip: 'Estimated',
    getFallbackUmaImageUrl: () => undefined,
    getPagerSlots: (page, total) => Array.from({length:total},(_,i)=>i+1),
    umaSortValue: () => 0, formatUmaColumnValue: () => '-',
    HISTORY_PAGE_SIZE: 5, UMA_TABLE_ROWS: 5, PAGER_SLOT_COUNT: 7,
    UMA_SORT_COLUMNS: [{key:'matches',label:'GP'},{key:'winRate',label:'Win'},{key:'pointsPerGame',label:'PPG'},{key:'performanceScore',label:'Score'}],
    React: { Fragment: 'Fragment' }, filterSnapshotForBuild: x => x,
    filterProfileStatesForDisplay: x => x, getLoadingDiscordIdsForDisplay: () => [],
  });
  for (const name of ['profileConstants', 'profileMerge', 'profileCache', 'explorerState']) {
    loadModuleTS(c, name);
  }
  loadFunction(c, playerDisplaySyntax, 'getDisplayedProfileStats');
  loadFunction(c, playerDisplaySyntax, 'withDetailHistory');
  loadFunction(c, playerDrawerSyntax, 'PlayerDrawer');
  loadFunction(c, teamSectionSyntax, 'getCardProfile');
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
function findAll(node, predicate, results = []) {
  if (!node || typeof node !== 'object') return results;
  if (predicate(node)) results.push(node);
  for (const child of (node.children ?? []).flat(Infinity)) findAll(child, predicate, results);
  return results;
}
function renderedRecent(c,p,scope) {
  const normalized=c.normalizeProfileSnapshotForDisplay({profiles:{[p.discordId]:p},loadingDiscordIds:[],updatedAt:Date.now()}).profiles[p.discordId];
  return c.PlayerDrawer({player:{discordId:p.discordId,displayName:'Fixture'},profile:normalized,
    context:{statsScope:scope,isProfileLoading:false,now:Date.now()},onClose(){}});
}

function drawerRuntime(c, p, scope = 'allTime') {
  const states = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, nextId = 0;
  c.crypto = { randomUUID: () => `fixture-request-${++nextId}` };
  c.useState = initial => {
    const index = stateIndex++;
    if (states[index] === undefined) states[index] = [initial, update => {
      states[index][0] = typeof update === 'function' ? update(states[index][0]) : update;
    }];
    return states[index];
  };
  c.useRef = initial => {
    const index = refIndex++;
    if (refs[index] === undefined) refs[index] = { current: initial };
    return refs[index];
  };
  c.useEffect = callback => { effects[effectIndex++] = callback; };
  const render = () => {
    stateIndex = refIndex = effectIndex = 0;
    return c.PlayerDrawer({player:{discordId:p.discordId,displayName:'Fixture'},profile:p,
      context:{statsScope:scope,isProfileLoading:false,now:Date.now()},onClose(){}});
  };
  return { render, effects };
}

test('cached history does not show on public details before its on-demand page opens',()=>{
  const c=harness(false), p=profile();
  const rendered=renderedRecent(c,p,'allTime');
  assert(!find(rendered,n=>n.type==='a' && n.props.href.endsWith('/FIX001')));
});
test('public cards discard history fields from an older cached batch profile',()=>{
  const c=harness(), p={...profile(),recentForm:{matches:5,scoringRate:1},historyTotal:25,historySummary:{wins:9}};
  p.allTimeStats={...p.allTimeStats,recentForm:p.recentForm,historyTotal:25,historySummary:p.historySummary};
  const card=c.getCardProfile(p,'allTime',false);
  assert.equal(card.recentMatches.length,0);
  assert.equal(card.recentForm,undefined);
  assert.equal(card.historyTotal,undefined);
  assert.equal(card.historySummary,undefined);
  assert.equal(c.getCardProfile(p,'allTime',true).recentMatches.length,1);
});
test('scope changes retain history through both the cache and player lookup, including private reconstruction',()=>{
  for (const privateBuild of [false,true]) {
    const c=harness(privateBuild), old={...profile(),statsPrivate:privateBuild,historyDerived:privateBuild};
    const next={...profile('currentSeason',[{...entry,matchId:'NEW001'}]),statsPrivate:privateBuild,historyDerived:privateBuild};
    for (const merged of [c.mergeProfileCache({[old.discordId]:old},{[old.discordId]:next},Date.now())[old.discordId],c.mergeExplorerProfiles({[old.discordId]:old},{[old.discordId]:next})[old.discordId]]) {
      assert.equal(c.getDisplayedProfileStats(merged,'allTime').recentMatches[0].matchId,'FIX001');
      assert.equal(c.getDisplayedProfileStats(merged,'currentSeason').recentMatches[0].matchId,'NEW001');
      assert(!find(renderedRecent(c,merged,'allTime'),n=>n.type==='a'));
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
test('new season and another player cannot inherit previous scoped history; loaded matches render',async()=>{
  const c=harness(), old=profile('currentSeason');
  const next={...profile(),activeSeasonId:'S2'};
  assert.equal(c.getDisplayedProfileStats(c.mergeProfileScopes(old,next),'currentSeason').recentMatches.length,0);
  const other={...profile('currentSeason',[]),discordId:'987654321098765432'};
  assert.equal(c.mergeProfileScopes(old,other).recentMatches.length,0);
  const many=profile('allTime',Array.from({length:8},(_,i)=>({...entry,matchId:`FIX00${i}`})));
  const runtime=drawerRuntime(c,many);
  c.sendPlayerHistoryPageRequest=async(_,__,page)=>({page,total:8,matches:many.recentMatches.slice((page-1)*5,page*5)});
  c.cancelPlayerHistoryPageRequest=async()=>{};
  c.sendPlayerProfileRequest=async()=>({title:null});
  c.cancelPlayerProfileRequest=async()=>{};
  runtime.render();
  runtime.effects[0]();
  await new Promise(resolve=>setImmediate(resolve));
  const firstPage=runtime.render();
  assert.equal(findAll(firstPage,node=>node.props?.className==='drawer-history-row').length,5);
  find(firstPage,node=>node.props?.['aria-label']==='Page 2').props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(findAll(runtime.render(),node=>node.props?.className==='drawer-history-row').length,3);
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

test('opening drawer requests page one, pager requests page two, and closing cancels pending work',async()=>{
  const c=harness(true);
  const requests=[], cancelled=[], profileRequests=[], profileCancelled=[];
  const badgeProfiles=[];
  c.getNotableBadges=value=>{badgeProfiles.push(value);return [];};
  c.sendPlayerHistoryPageRequest=(id,scope,page,requestId)=>{
    requests.push({id,scope,page,requestId});
    return page===1 ? Promise.resolve({page,total:21,matches:[entry],summary:{wins:1}}) : new Promise(()=>{});
  };
  c.cancelPlayerHistoryPageRequest=async requestId=>{cancelled.push(requestId);};
  c.sendPlayerProfileRequest=(id,requestId)=>{profileRequests.push({id,requestId});return new Promise(()=>{});};
  c.cancelPlayerProfileRequest=async requestId=>{profileCancelled.push(requestId);};
  const p=profile();
  const runtime=drawerRuntime(c,p);
  runtime.render();
  assert.equal(badgeProfiles.at(-1).recentForm,undefined);
  const closeHistory=runtime.effects[0]();
  const closeProfile=runtime.effects[1]();
  await new Promise(resolve=>setImmediate(resolve));
  const rendered=runtime.render();
  assert.equal(requests[0].page,1);
  assert.equal(findAll(rendered,node=>node.props?.className==='drawer-history-row').length,1);
  assert(find(rendered,node=>node.type==='a' && node.props.href.endsWith('/FIX001')));
  assert.equal(badgeProfiles.at(-1).recentForm.matches,1);
  assert.equal(badgeProfiles.at(-1).historySummary.wins,1);
  assert.equal(profileRequests.length,1,'opening drawer requests the profile once, alongside the first history page');
  assert.equal(profileRequests[0].id,p.discordId);
  const detail=c.withDetailHistory(p,[entry],21,{wins:1});
  assert.equal(detail.recentMatches[0].matchId,'FIX001');
  assert.equal(detail.recentForm.matches,1);
  assert.equal(detail.historySummary.wins,1);
  assert.equal(detail.matches,p.matches);
  find(rendered,node=>node.props?.['aria-label']==='Page 2').props.onClick();
  assert.equal(requests[1].page,2);
  closeHistory();
  assert.deepEqual(cancelled,[requests[1].requestId]);
  closeProfile();
  assert.deepEqual(profileCancelled,[profileRequests[0].requestId]);
});

test('a title already present on the profile summary is used without a profile request',async()=>{
  const c=harness();
  const profileRequests=[];
  c.sendPlayerHistoryPageRequest=()=>new Promise(()=>{});
  c.cancelPlayerHistoryPageRequest=async()=>{};
  c.sendPlayerProfileRequest=(id,requestId)=>{profileRequests.push({id,requestId});return new Promise(()=>{});};
  c.cancelPlayerProfileRequest=async()=>{};
  const p={...profile(),title:'Fixture Title'};
  const runtime=drawerRuntime(c,p);
  const details=runtime.render();
  runtime.effects[1]();
  assert.equal(profileRequests.length,0);
  const title=find(details,node=>node.props?.className==='player-title');
  assert.equal(title.children[0],'Fixture Title');
});

test('public cards discard cached history fields while drawer display permits fetched match rows', () => {
  const c = harness();
  const cached = { ...profile(), recentForm: { matches: 5, wins: 4 }, historyTotal: 25 };
  cached.allTimeStats = { ...cached.allTimeStats, recentForm: cached.recentForm, historyTotal: 25 };
  const card = c.getCardProfile(cached, 'allTime', false);
  assert.equal(card.recentMatches.length, 0);
  assert.equal(card.recentForm, undefined);
  assert.equal(card.historyTotal, undefined);
  const display = c.withDetailHistory(cached, [entry], 21, { wins: 1 });
  assert.equal(display.recentMatches[0].matchId, 'FIX001');
  assert.equal(display.historyTotal, 21);
  assert.equal(display.recentForm, undefined, 'the public UI must not derive stats from displayed history');
  assert.equal(display.matches, cached.matches);
});

test('history based recent form is available only in the private build', () => {
  assert.equal(harness(false).withDetailHistory(profile(), [entry], 1).recentForm, undefined);
  const privateForm = harness(true).withDetailHistory(profile(), [entry], 1).recentForm;
  assert.equal(privateForm.matches, 1);
  assert.equal(privateForm.wins, 1);
});

test('scope changes retain separate history and a new season cannot inherit the old season', () => {
  const c = harness();
  const old = profile('currentSeason');
  const incoming = profile('allTime', [{ ...entry, matchId: 'NEW001' }]);
  const merged = c.mergeProfileScopes(old, incoming);
  assert.equal(c.getDisplayedProfileStats(merged, 'currentSeason').recentMatches[0].matchId, 'FIX001');
  assert.equal(c.getDisplayedProfileStats(merged, 'allTime').recentMatches[0].matchId, 'NEW001');
  const nextSeason = c.mergeProfileScopes(old, { ...incoming, activeSeasonId: 'S2' });
  assert.equal(c.getDisplayedProfileStats(nextSeason, 'currentSeason').recentMatches.length, 0);
});

test('partial history updates preserve loaded rows; completed empty responses clear them', () => {
  const c = harness(true), old = profile();
  for (const status of ['loading', 'unavailable']) {
    const next = profile('allTime', []);
    next.allTimeStats.recentHistoryStatus = status;
    next.isPartial = status === 'loading';
    assert.equal(c.mergeProfileScopes(old, next).allTimeStats.recentMatches.length, 1);
  }
  assert.equal(c.mergeProfileScopes(old, profile('allTime', [])).recentMatches.length, 0);
});

test('privacy denial invalidates cached history in both scopes', () => {
  const c = harness(true), old = profile('currentSeason');
  const denied = profile('allTime', []);
  denied.statsPrivate = true;
  denied.recentHistoryStatus = 'private';
  denied.allTimeStats.recentHistoryStatus = 'private';
  const result = c.mergeProfileScopes(old, denied);
  assert.equal(result.recentMatches.length, 0);
  assert.equal(c.getDisplayedProfileStats(result, 'currentSeason').recentMatches.length, 0);
});

test('unfetched drawer uses the top status line without repeating the message in its footer', () => {
  const c = harness();
  loadFunction(c, playerDisplaySyntax, 'getProfileDataStatus');
  loadFunction(c, playerDisplaySyntax, 'getPlayerNote');
  assert.equal(c.getProfileDataStatus('123456789012345678', undefined, false, Date.now()).label,
    'Profile data has not loaded yet.');
  const tree = c.PlayerDrawer({ player: { discordId: '123456789012345678', displayName: 'Fixture' },
    profile: undefined, context: { statsScope: 'allTime', isProfileLoading: false, now: Date.now() }, onClose() {} });
  assert(!find(tree, node => node.props?.className === 'player-note' && node.children.includes('Profile data has not loaded yet.')));
});
