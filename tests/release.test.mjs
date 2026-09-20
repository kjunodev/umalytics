import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const root=path.resolve('release-fixture');
const source=fs.readFileSync(new URL('../scripts/publish-release.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/const root=.*;/,'');
function run({privateBuild=false, existing, uploadFails=false, listFails=false, wrongTag=false, noTag=false, wrongSource=false, wrongVersion=false, repository='skimuic/UmaLytics', packageOnly=false, platform='linux'}={}) {
  const sha='a'.repeat(40), calls=[], files=new Map(); let uploaded=false;
  const set=(file,value)=>files.set(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));
  set('package.json',{version:'0.4.1'});set('RELEASE-0.4.1.md','Notes');
  const builds=['chromium','firefox'].map(family=>({family,mode:'public',path:path.join(root,'.releases/build/public-'+family)}));
  set('.releases/latest.json',{version:'0.4.1',builds});
  for(const b of builds){files.set(path.join(b.path,'manifest.json'),JSON.stringify({version:'0.4.1',name:privateBuild?'UmaLytics Private':'UmaLytics'}));files.set(path.join(b.path,'background.js'),privateBuild?'/history?':'public');}
  const context={root,path,createHash,console:{log(){}},process:{argv:packageOnly?['node','script','--package-only']:[],platform,env:{GITHUB_REPOSITORY:repository,GITHUB_SHA:sha,RELEASE_VERSION:wrongVersion?'0.3.9':'0.4.1'}},
    fs:{readFileSync:file=>{if(!files.has(file))throw Error('Missing '+file);return files.get(file);},existsSync:file=>files.has(file),mkdirSync(){},writeFileSync:(file,value)=>files.set(file,value)},
    execFileSync:(cmd,args,options)=>{if(cmd==='git')return wrongSource?'b'.repeat(40):sha;calls.push([cmd,...args]);if(cmd==='zip'){files.set(args[1],'ZIP');return '';}
      if(cmd==='pwsh'){files.set(options.env.UMALYTICS_ZIP_DESTINATION,'ZIP');return '';}
      if(args[0]==='api'){
        if(listFails)throw Error('API unavailable');
        if(args[1].includes('matching-refs')) return JSON.stringify(noTag?[]:[{ref:'refs/tags/v0.4.1',object:{type:'commit',sha:wrongTag?'b'.repeat(40):sha}}]);
        if(args[1].includes('/releases/tags/')) throw Error('Drafts are unavailable by tag');
        if(uploaded) return JSON.stringify([{tag_name:'v0.4.1',draft:true,target_commitish:sha,assets:['umalytics-chromium-0.4.1-open-beta.1.zip','umalytics-firefox-0.4.1-open-beta.1.zip','SHA256SUMS.txt'].map(name=>({name,size:3}))}]);
        return JSON.stringify(existing?[existing]:[]);
      }
      if(args[1]==='download') {files.set(path.join(args[args.indexOf('--dir')+1],args[args.indexOf('--pattern')+1]),'ORIGINAL_PUBLISHED_ZIP');return '';}
      if(args[1]==='upload'){if(uploadFails)throw Error('Upload failed');uploaded=true;}return '';}};
  let error;try{vm.runInNewContext(source,context);}catch(e){error=e;}
  return {calls,error,sha,files};
}
test('release publishes only two public browser ZIPs and checksums after draft creation',()=>{
  const r=run();assert.equal(r.error,undefined);
  const create=r.calls.find(c=>c[2]==='create');assert(create.includes('--draft'));assert(create.includes(r.sha));
  assert.equal(create[3],'v0.4.1');assert.equal(create[create.indexOf('--title')+1],'UmaLytics 0.4.1');
  const edit=r.calls.find(c=>c[2]==='edit');assert(edit.includes('--prerelease=false'));assert(edit.includes('--draft=false'));
  const upload=r.calls.find(c=>c[2]==='upload');assert.equal(upload.filter(x=>x.endsWith('.zip')).length,2);assert(upload.some(x=>x.endsWith('SHA256SUMS.txt')));
  assert(r.calls.findIndex(c=>c[2]==='upload')<r.calls.findIndex(c=>c[2]==='edit'));
});

test('mirror cannot publish releases and workflow is restricted to the community repository',()=>{
  const r=run({repository:'kjunodev/umalytics'});assert.match(r.error.message,/Unexpected release repository/);assert.equal(r.calls.length,0);
  const workflow=fs.readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
  assert(workflow.includes("if: github.repository == 'skimuic/UmaLytics' && github.ref == 'refs/heads/main'"));
  assert(workflow.includes('tag="v${version}"'));
});

test('local packaging uses the canonical public ZIP names without any GitHub calls on either platform',()=>{
  for(const platform of ['linux','win32']) {
    const r=run({packageOnly:true,platform,repository:undefined});assert.equal(r.error,undefined);
    assert(!r.calls.some(c=>c[0]==='gh'));assert(r.calls.some(c=>c[0]===(platform==='win32'?'pwsh':'zip')));
    assert(r.files.has(path.join(root,'.releases/assets/umalytics-chromium-0.4.1-open-beta.1.zip')));
    assert(r.files.has(path.join(root,'.releases/assets/umalytics-firefox-0.4.1-open-beta.1.zip')));
    assert(r.files.has(path.join(root,'.releases/assets/SHA256SUMS.txt')));
  }
});
test('release rejects private artifacts before any GitHub mutation',()=>{const r=run({privateBuild:true});assert.match(r.error.message,/boundary/);assert.equal(r.calls.length,0);});
test('release does not publish when asset upload fails',()=>{const r=run({uploadFails:true});assert.match(r.error.message,/Upload failed/);assert(!r.calls.some(c=>c[2]==='edit'));});
test('release leaves an already-published version unchanged',()=>{const r=run({existing:{tag_name:'v0.4.1',draft:false,assets:['umalytics-chromium-0.4.1-open-beta.1.zip','umalytics-firefox-0.4.1-open-beta.1.zip','SHA256SUMS.txt'].map(name=>({name,size:3}))}});assert.equal(r.error,undefined);assert(!r.calls.some(c=>c[1]==='release'));});
test('release refuses a draft created for a different commit',()=>{const r=run({existing:{tag_name:'v0.4.1',draft:true,target_commitish:'b'.repeat(40)}});assert.match(r.error.message,/different commit/);assert(!r.calls.some(c=>c[1]==='release'));});
test('release API failure is not interpreted as a missing release',()=>{const r=run({listFails:true});assert.match(r.error.message,/API unavailable/);assert(!r.calls.some(c=>c[1]==='release'));});
test('release rejects an existing tag pointing at another commit',()=>{const r=run({wrongTag:true});assert.match(r.error.message,/tag points to a different commit/);assert(!r.calls.some(c=>c[1]==='release'));});
test('release rejects incomplete assets on a published rerun',()=>{const r=run({existing:{tag_name:'v0.4.1',draft:false,assets:[]}});assert.match(r.error.message,/asset set/);assert(!r.calls.some(c=>c[1]==='release'));});
test('release refuses a build from a different checkout commit',()=>{const r=run({wrongSource:true});assert.match(r.error.message,/source commit mismatch/);assert.equal(r.calls.length,0);});
test('release refuses an existing tag with a different package version',()=>{const r=run({wrongVersion:true});assert.match(r.error.message,/source version mismatch/);assert.equal(r.calls.length,0);});
test('release adds checksums to older published ZIPs without overwriting them',()=>{
  const r=run({existing:{tag_name:'v0.4.1',draft:false,assets:['umalytics-chromium-0.4.1-open-beta.1.zip','umalytics-firefox-0.4.1-open-beta.1.zip'].map(name=>({name,size:3}))}});
  assert.equal(r.error,undefined); const uploads=r.calls.filter(c=>c[2]==='upload');assert.equal(uploads.length,1);
  assert(uploads[0][4].endsWith('SHA256SUMS.txt'));assert(!uploads[0].includes('--clobber'));
  assert(!r.calls.some(c=>c[2]==='edit'||c[2]==='create'));
  const checksum=r.files.get(path.join(root,'.releases/assets/published/SHA256SUMS.txt'));
  assert(checksum.includes(createHash('sha256').update('ORIGINAL_PUBLISHED_ZIP').digest('hex')));
});
