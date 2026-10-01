import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { loadModule } from './harness.mjs';

export const evaluate = loadModule;
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise,resolve}; };
export const tick = () => new Promise(r => setImmediate(r));
export const sleep = ms => new Promise(r => setTimeout(r,ms));
export async function waitUntil(predicate,timeoutMs=1000) {
  const deadline=performance.now()+timeoutMs;
  while(!predicate()) {
    if(performance.now()>deadline) throw new Error('Timed out waiting for fixture condition');
    await sleep(5);
  }
}
export function context(globals = {}) {
  return vm.createContext({window:{location:{origin:'https://drafter.uma.guide'},postMessage(){}},console, URL, URLSearchParams, AbortController, DOMException, setTimeout, clearTimeout,
    defineBackground: () => {}, defineContentScript: () => {}, recordDiagnostic: () => {}, sendDiagnosticEvent: async () => {}, getLatestDraftSnapshot: async () => undefined, clearLatestDraftSnapshot: async () => {}, ...globals});
}
export function players(count=5) {
  return Array.from({length:count},(_,i)=>({userId:String(100000000000000000n+BigInt(i)),discordId:String(100000000000000000n+BigInt(i)),displayName:`Player ${i}`,team:i<(count===10?5:2)?'team1':'team2',partyId:null,partyRatingBonus:0}));
}
export const roster = (match='ROOM01', count=5) => ({matchCode:match,players:players(count)});
const stats = {summary:{matchesIncluded:4,totalPointsScored:12},umaEntries:[{umaId:'100101',matches:4,wins:2,losses:2,pointsScored:12}]};
export function apiHarness({responder, latency=2, fast=true, sessionStorage}={}) {
  const calls=[],callTimes=[],diagnostics=[]; let active=0, peak=0, aborts=0;
  const c=context({
    ...(sessionStorage ? {browser:{storage:{session:sessionStorage}}} : {}),
    recordDiagnostic:value=>diagnostics.push(value),
    fetch:async (url,init)=>{
      calls.push(url.pathname+url.search); callTimes.push(performance.now()); active++; peak=Math.max(peak,active);
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
  evaluate(c,'profileConstants'); evaluate(c,'umaReleaseOrder'); evaluate(c,'umaPortraits');
  evaluate(c,'requestQueue');evaluate(c,'playerProfileApi',{fast});
  return {c,calls,callTimes,diagnostics,get peak(){return peak;},get aborts(){return aborts;}};
}
export function backgroundHarness({stored = {}} = {}) {
  const snapshots=[],fetches=[],alarms=new Map(),allTimeFetches=[];let cached;let windowCount=0;let clock=Date.now();let latest=roster();let archive={};
  let allTimeStatsResponses={};
  class Clock extends Date { static now(){return clock;} }
  const c=context({Date:Clock, getApiCooldown:()=>undefined,restoreApiCooldown:()=>{},queueTeamIconRefresh:()=>Promise.resolve(),
    browser:{storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,structuredClone(value)),remove:async key=>{delete stored[key];}}},
      alarms:{clear:async name=>alarms.delete(name),create:async(name,info)=>alarms.set(name,info)},tabs:{query:async()=>[{id:1,active:true,url:'https://drafter.uma.guide/spectate/ROOM01'}]},scripting:{executeScript:async()=>{}},runtime:{getURL:p=>p},windows:{create:async()=>({id:++windowCount}),update:async()=>{}}},
    getLobbyLockState:async()=>undefined,setLatestPrematchRoster:async()=>{},getLatestPrematchRoster:async()=>latest,
    extractMatchCodeFromUrl:()=> 'ROOM01',getPlayerProfileSummaries:async()=>cached,
    getCachedPlayerProfiles:async()=>archive,rememberCachedPlayerProfiles:async profiles=>{archive=c.mergeProfileCache(archive,profiles,clock);},
    setPlayerProfileSummaries:async s=>{cached=structuredClone(s);snapshots.push(cached);},
    isHashedUmaAssetUrl:()=>false,
    fetchPlayerProfileSummaries:async (p,options)=>{const gate=deferred();fetches.push({players:p,options,gate});return await gate.promise ?? {};},
    fetchPlayerAllTimeStats:async discordId=>{allTimeFetches.push(discordId);return allTimeStatsResponses[discordId] ?? {
      wins:null,losses:null,winRate:null,matches:null,points:null,pointsPerGame:null,podiums:null,mvpMatches:null,
      topUmas:[],bestUmas:[],allUmas:[],recentMatches:[]
    };},
    sendRoomDomScanRequest:async()=>{await c.handlePrematchRosterDetected(roster());return{activeLobby:true,matchCode:'ROOM01'};}
  });
  evaluate(c,'profileConstants');evaluate(c,'rosterDisplay');evaluate(c,'profileCache');evaluate(c,'background');
  return {c,snapshots,fetches,alarms,stored,allTimeFetches,advance(ms){clock+=ms;},get now(){return clock;},get windowCount(){return windowCount;},
    set cached(s){cached=s;},set latest(r){latest=r;},set allTimeStatsResponses(v){allTimeStatsResponses=v;}};
}
export function summaryFor(player,overrides={}) {
  return {discordId:player.discordId,displayName:player.displayName,fetchedAt:Date.now(),profileUrl:'',statsScope:'currentSeason',
    rank:null,rating:null,ratingDeviation:null,conservativeRating:null,wins:null,losses:null,winRate:null,
    matches:null,points:null,pointsPerGame:null,podiums:null,mvpMatches:null,
    topUmas:[],bestUmas:[],allUmas:[],recentMatches:[],statsPrivate:false,
    currentSeasonStats:{matches:null},allTimeStats:{matches:null},...overrides};
}
export function roomHarness() {
  const c=context({cleanTeamName:x=>x, getUmaDisplayName:(id,name)=>name??id, normalizeUmaOutfitId:x=>x});
  evaluate(c,'matchDetection');evaluate(c,'syncPayload');evaluate(c,'playerExtraction');evaluate(c,'roomEvents');
  return {c,state:vm.runInContext('new RoomEventState()',c)};
}
export function matchEvent({room='M95Z2Z',version=1,phase='map-pick',members=players(10),rules}={}) {
  const team=()=>({pickedUmas:[],bannedUmas:[],preBannedUmas:[],pickedMaps:[],bannedMaps:[]});
  return {type:'match.snapshot',matchId:room,version,state:{phase,currentTeam:'team1',team1:team(),team2:team(),rules,
    multiplayer:{team1Name:'Blue',team2Name:'Red',...(members===null?{}:{rankedQueueRoster:members})}}};
}
export function domHarness(body) {
  const {document,HTMLElement}=parseHTML('<html><body>'+body+'</body></html>');
  HTMLElement.prototype.getBoundingClientRect=function(){return {top:0,left:Number(this.getAttribute('data-left')??0)};};
  const c=context({document});evaluate(c,'matchDetection');evaluate(c,'textCleanup');evaluate(c,'domLobbyExtraction');
  return {c,document};
}
export const realTrainerRow =(name='Fixture Trainer | 기',avatar='https://cdn.discordapp.com/avatars/100000000000000098/avatar.png')=>`<div data-trainer-player="true"><span class="trainer-companion"><img alt="Fine Motion companion" src="/uma/1001.png"></span><button data-trainer-trigger="true" aria-label="View ${name}'s trainer card"><img alt="${name}" src="${avatar}"></button><div><button data-trainer-trigger="true">${name}</button></div><span>Captain</span><span>Host</span></div>`;
export const lobbyFixture =(left,right)=>`<button title="Copy room code" aria-label="Copy room code">6XN-84X</button><section data-left="0"><h2>Team 1[edit]</h2>${left}</section><section data-left="400"><h2>Team 2</h2>${right}</section>`;
export function contentRoomHarness({delayDraft}={}) {
  let visibleRoom;let domRoster=null;const sent=[];
  const c=context({cleanTeamName:x=>x,getUmaDisplayName:(id,name)=>name??id,normalizeUmaOutfitId:x=>x,
    document:{},window:{location:{href:'https://drafter.uma.guide/host'},postMessage(){},clearTimeout},
    extractRoomCodeFromRoomDom:()=>visibleRoom,extractPrematchRosterFromRoomDom:()=>domRoster,
    extractDraftSnapshotFromDraftDom:()=>null,extractDraftSnapshotFromSyncedDraftState:()=>null,
    sendDraftSnapshot:async()=>{if(delayDraft)await delayDraft.promise;},sendPrematchRoster:async roster=>sent.push(structuredClone(roster))});
  evaluate(c,'matchDetection');evaluate(c,'syncPayload');evaluate(c,'playerExtraction');evaluate(c,'content');
  const send=event=>c.handleWindowMessage({type:'umalytics:room-event',hookVersion:4,payload:event});
  return {c,sent,send,show(room,roster){visibleRoom=room;domRoster=roster;}};
}
