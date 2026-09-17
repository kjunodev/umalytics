import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const root=path.resolve('release-fixture');
const source=fs.readFileSync(new URL('../scripts/publish-release.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/const root=.*;/,'');
function run({privateBuild=false, existing, uploadFails=false, listFails=false, wrongTag=false}={}) {
  const sha='a'.repeat(40), calls=[], files=new Map();
  const set=(file,value)=>files.set(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));
  set('package.json',{version:'0.4.0'});set('RELEASE-0.4.0.md','Notes');
  const builds=['chromium','firefox'].map(family=>({family,mode:'public',path:path.join(root,'.releases/build/public-'+family)}));
  set('.releases/latest.json',{version:'0.4.0',builds});
  for(const b of builds){files.set(path.join(b.path,'manifest.json'),JSON.stringify({version:'0.4.0',name:privateBuild?'UmaLytics Private':'UmaLytics'}));files.set(path.join(b.path,'background.js'),privateBuild?'/history?':'public');}
  const context={root,path,createHash,console:{log(){}},process:{env:{GITHUB_REPOSITORY:'kjunodev/umalytics',GITHUB_SHA:sha}},
    fs:{readFileSync:file=>{if(!files.has(file))throw Error('Missing '+file);return files.get(file);},existsSync:file=>files.has(file),mkdirSync(){},writeFileSync:(file,value)=>files.set(file,value)},
    execFileSync:(cmd,args)=>{calls.push([cmd,...args]);if(cmd==='zip'){files.set(args[1],'ZIP');return '';}
      if(args[0]==='api'){
        if(listFails)throw Error('API unavailable');
        if(args[1].includes('matching-refs')) return JSON.stringify([{ref:'refs/tags/v0.4.0-open-beta.1',object:{type:'commit',sha:wrongTag?'b'.repeat(40):sha}}]);
        if(args[1].includes('/releases/tags/')) return JSON.stringify({assets:['umalytics-chromium-0.4.0-open-beta.1.zip','umalytics-firefox-0.4.0-open-beta.1.zip','SHA256SUMS.txt'].map(name=>({name,size:3}))});
        return JSON.stringify(existing?[existing]:[]);
      }
      if(args[1]==='upload' && uploadFails)throw Error('Upload failed');return '';}};
  let error;try{vm.runInNewContext(source,context);}catch(e){error=e;}
  return {calls,error,sha,files};
}
test('release publishes only two public browser ZIPs and checksums after draft creation',()=>{
  const r=run();assert.equal(r.error,undefined);
  const create=r.calls.find(c=>c[2]==='create');assert(create.includes('--draft'));assert(create.includes(r.sha));
  const upload=r.calls.find(c=>c[2]==='upload');assert.equal(upload.filter(x=>x.endsWith('.zip')).length,2);assert(upload.some(x=>x.endsWith('SHA256SUMS.txt')));
  assert(r.calls.findIndex(c=>c[2]==='upload')<r.calls.findIndex(c=>c[2]==='edit'));
});
test('release rejects private artifacts before any GitHub mutation',()=>{const r=run({privateBuild:true});assert.match(r.error.message,/boundary/);assert.equal(r.calls.length,0);});
test('release does not publish when asset upload fails',()=>{const r=run({uploadFails:true});assert.match(r.error.message,/Upload failed/);assert(!r.calls.some(c=>c[2]==='edit'));});
test('release leaves an already-published version unchanged',()=>{const r=run({existing:{tag_name:'v0.4.0-open-beta.1',draft:false,assets:['umalytics-chromium-0.4.0-open-beta.1.zip','umalytics-firefox-0.4.0-open-beta.1.zip','SHA256SUMS.txt'].map(name=>({name,size:3}))}});assert.equal(r.error,undefined);assert(!r.calls.some(c=>c[1]==='release'));});
test('release refuses a draft created for a different commit',()=>{const r=run({existing:{tag_name:'v0.4.0-open-beta.1',draft:true,target_commitish:'b'.repeat(40)}});assert.match(r.error.message,/different commit/);assert(!r.calls.some(c=>c[1]==='release'));});
test('release API failure is not interpreted as a missing release',()=>{const r=run({listFails:true});assert.match(r.error.message,/API unavailable/);assert(!r.calls.some(c=>c[1]==='release'));});
test('release rejects an existing tag pointing at another commit',()=>{const r=run({wrongTag:true});assert.match(r.error.message,/tag points to a different commit/);assert(!r.calls.some(c=>c[1]==='release'));});
test('release rejects incomplete assets on a published rerun',()=>{const r=run({existing:{tag_name:'v0.4.0-open-beta.1',draft:false,assets:[]}});assert.match(r.error.message,/asset set/);assert(!r.calls.some(c=>c[1]==='release'));});
