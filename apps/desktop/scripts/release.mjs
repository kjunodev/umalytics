import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const repository = 'kjunodev/umalytics';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', cwd: root });
const api = (...args) => JSON.parse(gh('api', ...args));
const route = `repos/${repository}/releases`;
function release(tag) {
  try { return api(`${route}/tags/${tag}`); }
  catch (error) {
    if (String(error.stderr).includes('(HTTP 404)')) {
      // The tag endpoint exposes published releases; drafts may have no Git tag yet.
      return api('--paginate', '--slurp', `${route}?per_page=100`).flat().find(item => item.tag_name === tag) ?? null;
    }
    throw error;
  }
}
export function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)) throw new Error('Invalid desktop version');
  return version;
}
export function validateManifest(manifest, version, assets) {
  if (manifest.version !== version || !manifest.notes?.trim()) throw new Error('Updater manifest version or release notes are missing');
  const platforms = Object.entries(manifest.platforms ?? {});
  if (!platforms.length) throw new Error('Updater manifest has no platforms');
  for (const [platform, item] of platforms) {
    if (!/^windows-x86_64(?:-nsis)?$/.test(platform)) throw new Error(`Unexpected updater target: ${platform}`);
    const prefix = `https://github.com/${repository}/releases/download/desktop-v${version}/`;
    if (!item.url?.startsWith(prefix) || !item.url.endsWith('.exe') || !item.signature?.trim()) throw new Error('Updater must use a signed versioned NSIS asset');
    const name = decodeURIComponent(item.url.slice(prefix.length));
    if (!assets.includes(name) || !assets.includes(`${name}.sig`)) throw new Error('Updater installer or signature asset is missing');
  }
}
const output = (key, value) => {
  const delimiter = randomUUID();
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
};

async function main(command, requestedVersion) {
  if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Desktop releases run only on the canonical main branch');
  if (command === 'prepare') {
    const version = validateVersion(JSON.parse(readFileSync(`${root}/apps/desktop/package.json`, 'utf8')).version);
    const tag = `desktop-v${version}`;
    const existing = release(tag);
    output('version', version);
    output('skip', existing && !existing.draft ? 'true' : 'false');
    if (existing && !existing.draft) return;
    const notes = readFileSync(`${root}/apps/desktop/release-notes/${version}.md`, 'utf8');
    if (!notes.trim()) throw new Error('Desktop release notes must not be empty');
    const config = JSON.parse(readFileSync(`${root}/apps/desktop/src-tauri/tauri.conf.json`, 'utf8'));
    if (!config.plugins.updater.pubkey || config.plugins.updater.pubkey.includes('PASTE')) throw new Error('Updater public key is required');
    const source = existing?.target_commitish ?? process.env.GITHUB_SHA;
    if (!/^[a-f0-9]{40}$/.test(source)) throw new Error('Draft release must pin an immutable source commit');
    output('source', source);
  } else if (command === 'draft') {
    const version = validateVersion(requestedVersion);
    const current = JSON.parse(readFileSync(`${root}/apps/desktop/package.json`, 'utf8')).version;
    if (current !== version) throw new Error('Selected source does not match desktop version');
    const tag = `desktop-v${version}`;
    let draft = release(tag);
    if (draft && !draft.draft) throw new Error('Refusing to alter a published release');
    const body = readFileSync(`${root}/apps/desktop/release-notes/${version}.md`, 'utf8');
    if (!draft) draft = api(route, '--method', 'POST', '-f', `tag_name=${tag}`, '-f', `target_commitish=${process.env.DESKTOP_SOURCE}`, '-f', `name=UmaLytics Desktop ${version}`, '-f', `body=${body}`, '-F', 'draft=true', '-f', 'make_latest=false');
    output('release-id', draft.id);
    output('release-body', body);
  } else if (command === 'publish') {
    const version = validateVersion(requestedVersion);
    const tag = `desktop-v${version}`;
    const draft = release(tag);
    if (!draft) throw new Error(`Missing release ${tag}`);
    const assets = draft.assets.map(asset => asset.name);
    const manifestAsset = draft.assets.find(asset => asset.name === 'latest.json');
    if (!manifestAsset) throw new Error('Draft is missing latest.json');
    const raw = gh('api', `repos/${repository}/releases/assets/${manifestAsset.id}`, '-H', 'Accept: application/octet-stream');
    const manifest = JSON.parse(raw);
    validateManifest(manifest, version, assets);
    for (const item of Object.values(manifest.platforms)) {
      const installer = decodeURIComponent(new URL(item.url).pathname.split('/').at(-1));
      const signature = draft.assets.find(asset => asset.name === `${installer}.sig`);
      const rawSignature = gh('api', `repos/${repository}/releases/assets/${signature.id}`, '-H', 'Accept: application/octet-stream');
      if (rawSignature.trim() !== item.signature.trim()) throw new Error('Manifest signature does not match the uploaded signature asset');
    }
    // Keep a retry from replacing a newer feed with an older version.
    const feed = release('desktop-updater');
    const previous = feed?.assets.find(asset => asset.name === 'latest.json');
    if (previous) {
      const published = JSON.parse(gh('api', `repos/${repository}/releases/assets/${previous.id}`, '-H', 'Accept: application/octet-stream'));
      if (published.version !== version) {
        const { compare } = await import('./version.mjs');
        if (compare(version, published.version) <= 0) throw new Error('Refusing to roll back the desktop updater feed');
      }
    }
    if (draft.draft) api(`${route}/${draft.id}`, '--method', 'PATCH', '-F', 'draft=false', '-f', 'make_latest=false');
    if (!feed) api(route, '--method', 'POST', '-f', 'tag_name=desktop-updater', '-f', `target_commitish=${draft.target_commitish}`, '-f', 'name=Desktop updater feed', '-f', 'body=Stable endpoint for signed UmaLytics desktop updates.', '-F', 'draft=false', '-f', 'make_latest=false');
    else if (feed.draft) throw new Error('The desktop-updater release must be published');
    const file = `${process.env.RUNNER_TEMP}/latest.json`;
    writeFileSync(file, raw);
    gh('release', 'upload', 'desktop-updater', file, '--clobber', '--repo', repository);
  } else throw new Error('Unknown desktop release command');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(...process.argv.slice(2));
