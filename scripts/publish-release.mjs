import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
if(!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid release version');
if(process.env.RELEASE_VERSION && process.env.RELEASE_VERSION!==version) throw Error('Release source version mismatch');
const repo=process.env.GITHUB_REPOSITORY;
const packageOnly=process.argv.includes('--package-only');
if(!packageOnly && repo!=='skimuic/UmaLytics') throw Error('Unexpected release repository');
const sha=process.env.RELEASE_SOURCE_SHA ?? process.env.GITHUB_SHA;
if(!packageOnly && !/^[a-f0-9]{40}$/.test(sha??'')) throw Error('Missing exact release commit');
if(!packageOnly && execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==sha) throw Error('Release source commit mismatch');
const tag=`v${version}`;
const notesPath=path.join(root,`.github/release-notes/${version}.md`);
const legacyNotesPath=path.join(root,`RELEASE-${version}.md`);
const notes=fs.existsSync(notesPath) ? notesPath : legacyNotesPath;
if(!fs.existsSync(notes)) throw Error('Release notes are required');
const release=JSON.parse(fs.readFileSync(path.join(root,'.releases/latest.json')));
if(release.version!==version || release.builds.length!==2) throw Error('Unexpected build set');
const output=path.join(root,'.releases/assets');fs.mkdirSync(output,{recursive:true});
const assets=[];
for(const family of ['chromium','firefox']) {
  const build=release.builds.find(x=>x.family===family && x.mode==='public');
  if(!build) throw Error('Public build missing');
  const dir=path.resolve(build.path);
  if(!dir.startsWith(path.resolve(root,'.releases')+path.sep)) throw Error('Build outside release directory');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
  // Public stats boundaries are checked in tests/public-boundary.test.mjs and
  // the stats-versus-history fixture in tests/batch-profiles.test.mjs.
  if(manifest.version!==version || manifest.name!=='UmaLytics') throw Error('Public boundary/version check failed');
  const asset=path.join(output,`umalytics-${family}-${version}-open-beta.1.zip`);
  // The release runner is Linux; fresh output avoids adding stale files to an existing ZIP.
  if(fs.existsSync(asset)) throw Error('Asset already exists; use a fresh build directory');
  if(process.platform==='win32') {
    execFileSync('pwsh',['-NoProfile','-Command',"$ErrorActionPreference='Stop'; Compress-Archive -Path (Join-Path $env:UMALYTICS_ZIP_SOURCE '*') -DestinationPath $env:UMALYTICS_ZIP_DESTINATION"],
      {cwd:dir,stdio:'inherit',env:{...process.env,UMALYTICS_ZIP_SOURCE:dir,UMALYTICS_ZIP_DESTINATION:asset}});
  } else execFileSync('zip',['-qr',asset,'.'],{cwd:dir,stdio:'inherit'});
  assets.push(asset);
}
const sums=path.join(output,'SHA256SUMS.txt');
fs.writeFileSync(sums,assets.map(file=>`${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`).join('\n')+'\n');
assets.push(sums);
if(packageOnly) {
  console.log(`Local public assets verified and packaged: ${output}`);
} else {
const gh=(...args)=>execFileSync('gh',args,{cwd:root,encoding:'utf8'}).trim();
const refs=JSON.parse(gh('api',`repos/${repo}/git/matching-refs/tags/${tag}`));
const ref=refs.find(r=>r.ref===`refs/tags/${tag}`);
if(ref) {
  let object=ref.object;
  for(let depth=0;object.type==='tag' && depth<8;depth++) object=JSON.parse(gh('api',`repos/${repo}/git/tags/${object.sha}`)).object;
  if(object.type!=='commit' || object.sha!==sha) throw Error('Existing tag points to a different commit');
}
const verifyAssets=release=>{
  const expected=assets.map(file=>path.basename(file));
  if(release.assets?.length!==expected.length || !expected.every(name=>release.assets.some(asset=>asset.name===name && asset.size>0))) throw Error('Published asset set is incomplete or unexpected');
};
// List succeeds or fails explicitly; an authentication/network error must not look like a missing release.
const existing=JSON.parse(gh('api',`repos/${repo}/releases?per_page=100`)).find(r=>r.tag_name===tag);
if(existing && !existing.draft) {
  if(!ref) throw Error('Published release tag is missing');
  const zipNames=assets.filter(file=>file.endsWith('.zip')).map(file=>path.basename(file));
  if(existing.assets?.length===2 && zipNames.every(name=>existing.assets.some(asset=>asset.name===name && asset.size>0))) {
    // Older published releases have only the browser ZIPs. Hash those exact downloads;
    // never replace their archives or generate checksums from a newly rebuilt ZIP.
    const downloaded=path.join(output,'published');fs.mkdirSync(downloaded,{recursive:true});
    for(const name of zipNames) gh('release','download',tag,'--repo',repo,'--pattern',name,'--dir',downloaded);
    const publishedSums=path.join(downloaded,'SHA256SUMS.txt');
    fs.writeFileSync(publishedSums,zipNames.map(name=>`${createHash('sha256').update(fs.readFileSync(path.join(downloaded,name))).digest('hex')}  ${name}`).join('\n')+'\n');
    gh('release','upload',tag,publishedSums,'--repo',repo);
    existing.assets.push({name:'SHA256SUMS.txt',size:fs.readFileSync(publishedSums).length});
  }
  verifyAssets(existing);
  console.log(`Release already published: ${existing.html_url}`);
} else {
  if(existing && existing.target_commitish!==sha) throw Error('Existing draft belongs to a different commit');
  if(!existing) gh('release','create',tag,'--repo',repo,'--target',sha,'--title',`UmaLytics ${version}`,'--notes-file',notes,'--draft');
  gh('release','upload',tag,...assets,'--repo',repo,'--clobber');
  // GitHub's by-tag endpoint can return 404 for drafts; the authenticated list includes them.
  const uploaded=JSON.parse(gh('api',`repos/${repo}/releases?per_page=100`)).find(r=>r.tag_name===tag);
  if(!uploaded?.draft || uploaded.target_commitish!==sha) throw Error('Draft target verification failed');
  verifyAssets(uploaded);
  gh('release','edit',tag,'--repo',repo,'--draft=false','--prerelease=false','--latest');
  console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
}
}
