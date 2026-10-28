import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, context, players, roomHarness, matchEvent } from './support/helpers.mjs';

// The page hook runs as a MAIN-world content script; tests load its runtime directly.
function hookHarness({href='https://drafter.uma.guide/host',room='M95Z2Z'}={}) {
  const {c}=roomHarness();const messages=[];const logged=[];const roomLookups=[];let socketListener;
  const w={location:{origin:'https://drafter.uma.guide',href},
    console:{log:(...a)=>logged.push(a),debug(){},info(){}},addEventListener(){},postMessage:m=>messages.push(m),
    WebSocket:class {addEventListener(type,fn){socketListener=fn;}}};
  Object.assign(c,{window:w,document:{},extractRoomCodeFromRoomDom:()=>{roomLookups.push(1);return room;},Blob,ArrayBuffer,TextDecoder});
  evaluate(c,'pageHookRuntime');c.installPageHook();new w.WebSocket('wss://drafter-api.uma.guide/socket.io/');
  const frame=event=>socketListener({data:'42'+JSON.stringify(['server:event',event])});
  return {c,w,messages,logged,roomLookups,frame,socket:data=>socketListener({data})};
}

test('page hook forwards typed frames but does not promote arbitrary player arrays',()=>{
  const {c}=roomHarness();const messages=[];
  Object.assign(c,{Blob,ArrayBuffer,TextDecoder,window:{location:{origin:'https://drafter.uma.guide'},postMessage:message=>messages.push(message)}});
  evaluate(c,'pageHookRuntime');
  c.inspectPossiblePayload('42'+JSON.stringify(['server:event',matchEvent()]),'websocket','M95Z2Z');
  c.inspectPossiblePayload({roomCode:'M95Z2Z',players:players(2)},'websocket','M95Z2Z');
  c.inspectPossiblePayload({roomCode:'M95Z2Z',players:players(2)},'storage','M95Z2Z');
  assert.equal(messages.length,1);assert.equal(messages[0].type,'umalytics:room-event');assert.equal(messages[0].hookVersion,4);
});

test('page hook startup never reads site localStorage or sessionStorage',()=>{
  const w={location:{origin:'https://drafter.uma.guide'},console:{debug(){},log(){},info(){}},addEventListener(){},WebSocket:class {addEventListener(){} }};
  Object.defineProperties(w,{localStorage:{get(){throw new Error('Unexpected storage read');}},sessionStorage:{get(){throw new Error('Unexpected storage read');}}});
  const c=context({window:w});evaluate(c,'pageHookRuntime');c.installPageHook();
});

test('early hook captures socket events before listener startup and replays only the active room',()=>{
  const {c}=roomHarness();const messages=[];let room='M95Z2Z';let socketListener;
  const w={location:{origin:'https://drafter.uma.guide',href:'https://drafter.uma.guide/host'},
    console:{log(){},debug(){},info(){}},addEventListener(){},postMessage:m=>messages.push(m),
    WebSocket:class {addEventListener(type,fn){socketListener=fn;}}};
  Object.assign(c,{window:w,document:{},extractRoomCodeFromRoomDom:()=>room,Blob,ArrayBuffer,TextDecoder});
  evaluate(c,'pageHookRuntime');c.installPageHook();new w.WebSocket('wss://drafter-api.uma.guide/socket.io/');
  socketListener({data:'42'+JSON.stringify(['server:event',matchEvent({version:5})])});
  socketListener({data:'42'+JSON.stringify(['server:event',matchEvent({version:3})])});
  socketListener({data:'42'+JSON.stringify(['server:event',{type:'room.presence.updated',matchId:'M95Z2Z',participants:players(10),secret:'DO-NOT-COPY'}])});
  socketListener({data:'42'+JSON.stringify(['server:event',matchEvent({room:'OTHER1'})])});
  messages.length=0;
  c.replayRoomEvents({source:{},origin:w.location.origin,data:{type:'umalytics:request-room-events'}});assert.equal(messages.length,0);
  c.replayRoomEvents({source:w,origin:w.location.origin,data:{type:'umalytics:request-room-events'}});
  assert.equal(messages.length,2);assert.equal(messages[0].payload.version,5);
  assert(messages.every(m=>m.payload.matchId==='M95Z2Z'));assert(!JSON.stringify(messages).includes('DO-NOT-COPY'));
  messages.length=0;room='NEXT01';c.replayRoomEvents({source:w,origin:w.location.origin,data:{type:'umalytics:request-room-events'}});assert.equal(messages.length,0);
  const original=w.WebSocket;c.installPageHook();assert.equal(w.WebSocket,original);
});

test('console hook never breaks site logging, even when the payload cannot be cloned',()=>{
  const h=hookHarness();
  h.w.postMessage=()=>{throw new Error('DataCloneError');};
  const sync={syncedDraftState_multiplayer:{roomCode:'M95Z2Z',rankedQueueRoster:players(10)}};
  assert.doesNotThrow(()=>h.w.console.log('[SYNC EFFECT] Starting sync',sync));
  assert.equal(h.logged.length,1);assert.equal(h.logged[0][0],'[SYNC EFFECT] Starting sync');
  assert.doesNotThrow(()=>h.w.console.log('[SYNC EFFECT] Starting sync',{get roomCode(){throw new Error('hostile getter');}}));
  assert.equal(h.logged.length,2);
});

test('console sync is forwarded with the visible room; socket frames never look up the room',()=>{
  const h=hookHarness();
  h.frame(matchEvent({version:1}));h.frame({type:'room.presence.updated',matchId:'M95Z2Z',participants:players(2)});
  h.socket('42'+JSON.stringify(['chat:message',{players:players(2)}]));
  assert.equal(h.roomLookups.length,0);
  h.w.console.log('[SYNC EFFECT] Starting sync',{syncedDraftState_multiplayer:{rankedQueueRoster:players(10)}});
  assert(h.roomLookups.length>0);
  const synced=h.messages.filter(m=>m.type==='umalytics:synced-draft-state');
  assert.equal(synced.length,1);assert.equal(synced[0].source,'console');assert.equal(synced[0].payload.syncedDraftState_multiplayer.roomCode,'M95Z2Z');
});

test('frames that cannot be server events are not parsed',()=>{
  const h=hookHarness();let parses=0;
  h.c.JSON={stringify:JSON.stringify,parse:(...args)=>{parses++;return JSON.parse(...args);}};
  h.socket('42'+JSON.stringify(['profile:data',{players:players(10),participants:players(10)}]));
  h.socket(JSON.stringify({rankedQueueRoster:players(10)}));
  assert.equal(parses,0);assert.equal(h.messages.length,0);
  h.frame(matchEvent());assert(parses>0);assert.equal(h.messages.length,1);
});

test('live events are always forwarded; only the replay buffer drops older versions',()=>{
  const h=hookHarness();
  h.frame(matchEvent({version:5}));h.frame(matchEvent({version:3}));
  assert.deepEqual(h.messages.map(m=>m.payload.version),[5,3]);
  h.messages.length=0;
  h.c.replayRoomEvents({source:h.w,origin:h.w.location.origin,data:{type:'umalytics:request-room-events'}});
  assert.deepEqual(h.messages.map(m=>m.payload.version),[5]);
});
