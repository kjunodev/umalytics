import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
const base = new URL('../apps/extension/utils/', import.meta.url);
function event() { const handlers = new Set(); return { addListener:f=>handlers.add(f), removeListener:f=>handlers.delete(f), fire:(...args)=>{for(const f of [...handlers])f(...args)}, size:()=>handlers.size }; }
function evaluate(name, globals) { const code=fs.readFileSync(new URL(name,base),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,''); const c=vm.createContext({AbortController,Error,Date,URL,URLSearchParams,console,setTimeout,clearTimeout,EXPLORER_PORT:'explorer',...globals}); vm.runInContext(stripTypeScriptTypes(code,{mode:'transform'}),c); return c; }
function client() { const port={onMessage:event(),onDisconnect:event(),sent:[],disconnects:0,postMessage(x){this.sent.push(x)},disconnect(){this.disconnects++}}; const c=evaluate('explorerClient.ts',{browser:{runtime:{connect:()=>port}}});return {port,c}; }
let checks=0;
{const {port,c}=client(); const ac=new AbortController(); ac.abort();assert.throws(()=>c.loadHistoricalMatch('AAA111',ac.signal)); assert.equal(port.sent.length,0);checks++;}
{const {port,c}=client(); const ac=new AbortController();let changes=0;const p=c.loadExplorerProfiles([], 'allTime',()=>changes++,ac.signal);port.onMessage.fire({type:'progress',profiles:{}});ac.abort();await assert.rejects(p,/cancelled/);port.onMessage.fire({type:'result',data:{late:true}});assert.equal(changes,1);assert.equal(port.onMessage.size(),0);assert.equal(port.onDisconnect.size(),0);assert.equal(port.disconnects,1);checks++;}
{const {port,c}=client();const p=c.loadHistoricalMatch('AAA111',new AbortController().signal);port.onDisconnect.fire();await assert.rejects(p,/interrupted/);assert.equal(port.onMessage.size(),0);checks++;}
{const {port,c}=client();const ac=new AbortController();const p=c.loadHistoricalMatch('AAA111',ac.signal);port.onMessage.fire({type:'result',data:'correct'});ac.abort();assert.equal(await p,'correct');assert.equal(port.disconnects,1);checks++;}
{const {port,c}=client();port.postMessage=()=>{throw Error('closed')};await assert.rejects(c.loadHistoricalMatch('AAA111',new AbortController().signal),/interrupted/);checks++;}
function service() { const onConnect=event();const c=evaluate('explorerService.ts',{browser:{runtime:{id:'id',getURL:path=>'chrome-extension://id/'+path.replace(/^\//,''),onConnect}}, getApiCooldown:()=>undefined});let observed;let calls=0;c.validateExplorerRequest=x=>x;c.executeExplorerRequest=async(x,signal,progress)=>{calls++;observed=signal;progress({first:true});return {okay:true}};c.registerExplorerService(()=>Promise.resolve());return {onConnect,c,get observed(){return observed},get calls(){return calls}};}
function port(sender) {return {name:'explorer',sender,onMessage:event(),onDisconnect:event(),sent:[],disconnected:false,postMessage(x){this.sent.push(x)},disconnect(){this.disconnected=true}};}
for(const sender of [undefined,{id:'other',url:'chrome-extension://id/scout.html'},{id:'id',url:'https://drafter.uma.guide/host'},{id:'id',url:'chrome-extension://id/scout.html/extra'},{id:'id',url:'chrome-extension://id/popup.html'}]) {const s=service();const p=port(sender);s.onConnect.fire(p);assert(p.disconnected);assert.equal(p.onMessage.size(),0);checks++;}
for(const suffix of ['', '?test=1', '#hash']) {const s=service();const p=port({id:'id',url:'chrome-extension://id/scout.html'+suffix});s.onConnect.fire(p);assert(!p.disconnected);p.onMessage.fire({kind:'match'});p.onMessage.fire({kind:'match'});await new Promise(r=>setImmediate(r));assert.equal(s.calls,1);assert.equal(p.sent.length,2);p.onDisconnect.fire();assert(s.observed.aborted);checks++;}
{const s=service();const p=port({id:'id',url:'chrome-extension://id/scout.html'});s.onConnect.fire(p);p.onMessage.fire({});p.onDisconnect.fire();await new Promise(r=>setImmediate(r));assert(s.observed.aborted);assert.equal(p.sent.length,0);checks++;}
console.log(`${checks} transport and sender checks passed`);

