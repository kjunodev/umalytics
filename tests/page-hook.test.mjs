import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, context, players, roomHarness, matchEvent } from './support/helpers.mjs';

test('page hook forwards typed frames but does not promote arbitrary player arrays',()=>{
  const {c}=roomHarness();const messages=[];
  Object.assign(c,{Blob,ArrayBuffer,TextDecoder,defineUnlistedScript:()=>{},window:{location:{origin:'https://drafter.uma.guide'},postMessage:message=>messages.push(message)}});
  evaluate(c,'pageHook');
  c.inspectPossiblePayload('42'+JSON.stringify(['server:event',matchEvent()]),'websocket','M95Z2Z');
  c.inspectPossiblePayload({roomCode:'M95Z2Z',players:players(2)},'websocket','M95Z2Z');
  c.inspectPossiblePayload({roomCode:'M95Z2Z',players:players(2)},'storage','M95Z2Z');
  assert.equal(messages.length,1);assert.equal(messages[0].type,'umalytics:room-event');assert.equal(messages[0].hookVersion,4);
});

test('page hook startup never reads site localStorage or sessionStorage',()=>{
  const w={location:{origin:'https://drafter.uma.guide'},console:{debug(){},log(){},info(){}},addEventListener(){},WebSocket:class {addEventListener(){} }};
  Object.defineProperties(w,{localStorage:{get(){throw new Error('Unexpected storage read');}},sessionStorage:{get(){throw new Error('Unexpected storage read');}}});
  const c=context({window:w,defineUnlistedScript:fn=>fn()}); evaluate(c,'pageHook');
});

test('early hook captures socket events before listener startup and replays only the active room',()=>{
  const {c}=roomHarness();const messages=[];let room='M95Z2Z';let socketListener;
  const w={location:{origin:'https://drafter.uma.guide',href:'https://drafter.uma.guide/host'},
    console:{log(){},debug(){},info(){}},addEventListener(){},postMessage:m=>messages.push(m),
    WebSocket:class {addEventListener(type,fn){socketListener=fn;}}};
  Object.assign(c,{window:w,document:{},extractRoomCodeFromRoomDom:()=>room,Blob,ArrayBuffer,TextDecoder,defineUnlistedScript:fn=>fn()});
  evaluate(c,'pageHook');new w.WebSocket('wss://drafter-api.uma.guide/socket.io/');
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
