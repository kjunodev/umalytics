import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
if(!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid release version');
const repo=process.env.GITHUB_REPOSITORY;
if(!['skimuic/UmaLytics','kjunodev/umalytics'].includes(repo)) throw Error('Unexpected release repository');
const sha=process.env.GITHUB_SHA;
if(!/^[a-f0-9]{40}$/.test(sha??'')) throw Error('Missing exact release commit');
const tag=`v${version}-open-beta.1`;
const notes=path.join(root,`RELEASE-${version}.md`);
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
  const background=fs.readFileSync(path.join(dir,'background.js'),'utf8');
  if(manifest.version!==version || manifest.name!=='UmaLytics' || background.includes('/history?')) throw Error('Public boundary/version check failed');
  const asset=path.join(output,`umalytics-${family}-${version}-open-beta.1.zip`);
  // The release runner is Linux; fresh output avoids adding stale files to an existing ZIP.
  if(fs.existsSync(asset)) throw Error('Asset already exists; use a fresh build directory');
  execFileSync('zip',['-qr',asset,'.'],{cwd:dir,stdio:'inherit'});
  assets.push(asset);
}
const sums=path.join(output,'SHA256SUMS.txt');
fs.writeFileSync(sums,assets.map(file=>`${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`).join('\n')+'\n');
assets.push(sums);
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
  verifyAssets(existing);
  console.log(`Release already published: ${existing.html_url}`);
} else {
  if(existing && existing.target_commitish!==sha) throw Error('Existing draft belongs to a different commit');
  if(!existing) gh('release','create',tag,'--repo',repo,'--target',sha,'--title',`UmaLytics ${version} Open Beta`,'--notes-file',notes,'--draft','--prerelease');
  gh('release','upload',tag,...assets,'--repo',repo,'--clobber');
  verifyAssets(JSON.parse(gh('api',`repos/${repo}/releases/tags/${tag}`)));
  gh('release','edit',tag,'--repo',repo,'--draft=false','--prerelease','--latest=false');
  console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
}
