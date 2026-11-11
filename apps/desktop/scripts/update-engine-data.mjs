import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { engineDataDir, engineRevision, prepareResources } from './prepare-resources.mjs';

const native = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const manifestPath = path.join(native, 'Cargo.toml');
const lockPath = path.join(native, 'Cargo.lock');
const gameTora = 'https://gametora.com/data';
const manifestUrl = `${gameTora}/manifests/umamusume.json`;
const webpSource = 'https://uma.guide/icon/skill/utx_ico_skill_';
const pngSource = 'https://media.gametora.com/umamusume/skills/icon/';

async function snapshot(dir) {
  const names = JSON.parse(await readFile(path.join(dir, 'names.json'), 'utf8'));
  const db = new DatabaseSync(path.join(dir, 'master_sim.db'), { readOnly: true });
  try {
    return { names, skillIds: new Set(db.prepare('SELECT id FROM skill_data').all().map(row => row.id)) };
  } finally {
    db.close();
  }
}

async function download(url, contentType, allowMissing = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (allowMissing && response.status === 404) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.ok || !response.headers.get('content-type')?.startsWith(contentType)) {
    await response.body?.cancel();
    throw new Error(`Unexpected response from ${url} (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function refreshGameTora() {
  const destination = path.join(native, 'resources/skill-data');
  const stage = await mkdtemp(path.join(native, 'resources/.skill-data-'));
  const next = path.join(stage, 'next');
  const backup = path.join(stage, 'previous');
  let retainBackup = false;
  try {
    const icons = path.join(next, 'icons');
    await mkdir(icons, { recursive: true });
    const manifest = JSON.parse(await download(manifestUrl, 'application/json'));
    await writeFile(path.join(next, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const sources = ['skills', 'static/skill_conditions', 'static/skill_condition_values', 'static/skill_effect_values'].map(key => {
      if (!/^[a-f0-9]{8}$/.test(manifest[key])) throw new Error(`GameTora manifest is missing ${key}`);
      return { filename: `${key.replace('/', '_')}.json`, url: `${gameTora}/umamusume/${key}.${manifest[key]}.json` };
    });
    let skills;
    for (const { filename, url } of sources) {
      const contents = await download(url, 'application/json');
      const data = JSON.parse(contents);
      if (filename === 'skills.json') skills = data;
      await writeFile(path.join(next, filename), contents);
    }
    if (!Array.isArray(skills)) throw new Error('GameTora skills.json must contain an array');
    const target = skills.find(skill => skill.id === 110311);
    if (!Number.isInteger(target?.iconid) || target.iconid <= 0) throw new Error('GameTora has no icon ID for Fresh☆Parlor (110311)');
    const ids = [...new Set(skills.flatMap(skill => [skill.iconid, skill.gene_version?.iconid]).filter(id => Number.isInteger(id) && id > 0))];
    for (let i = 0; i < ids.length; i += 8) {
      const results = await Promise.allSettled(ids.slice(i, i + 8).map(async id => {
        const webp = await download(`${webpSource}${id}.webp`, 'image/webp', true);
        const contents = webp ?? await download(`${pngSource}${id}.png`, 'image/png');
        await writeFile(path.join(icons, `${id}.${webp ? 'webp' : 'png'}`), contents);
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
    const date = new Date().toLocaleDateString('sv-SE');
    const credits = (await readFile(path.join(destination, 'CREDITS.md'), 'utf8'))
      .replace(/^Sources:[\s\S]*?(?=^Downloaded:)/m, [
        'Sources:', `- GameTora manifest: ${manifestUrl}`,
        ...sources.map(({ filename, url }) => `- ${filename}: ${url}`),
        `- Skill icons: ${webpSource}{id}.webp and ${pngSource}{id}.png`,
      ].join('\n') + '\n\n')
      .replace(/^Downloaded:.*$/m, `Downloaded: ${date}.`);
    await writeFile(path.join(next, 'CREDITS.md'), credits);
    await rename(destination, backup);
    try {
      await rename(next, destination);
    } catch (error) {
      retainBackup = true;
      await rename(backup, destination);
      retainBackup = false;
      throw error;
    }
    console.log(`Refreshed GameTora data (${skills.length} skill rows and ${ids.length} icons), including Fresh☆Parlor (110311 → ${target.iconid}).`);
  } finally {
    if (retainBackup) console.error(`Previous skill data is available at ${backup}`);
    else await rm(stage, { recursive: true, force: true });
  }
}

const [sha, flag, ...extra] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/i.test(sha ?? '') || (flag && flag !== '--refresh-gametora') || extra.length) {
  console.error('Usage: node apps/desktop/scripts/update-engine-data.mjs <40-character fork SHA> [--refresh-gametora]');
  process.exit(1);
}

const manifest = await readFile(manifestPath, 'utf8');
const lock = await readFile(lockPath);
const previousData = await engineDataDir();
const before = await snapshot(previousData);
let after;
try {
  await writeFile(manifestPath, manifest.replace(engineRevision, (line, revision) => line.replace(`"${revision}"`, `"${sha.toLowerCase()}"`)));
  execFileSync('cargo', ['update', '-p', 'uma_race_sim', '--manifest-path', manifestPath], { stdio: 'inherit' });
  const nextData = await engineDataDir();
  after = await snapshot(nextData);
  await prepareResources(nextData);
} catch (error) {
  await writeFile(manifestPath, manifest);
  await writeFile(lockPath, lock);
  throw error;
}

console.log(`Engine skills: ${before.skillIds.size} → ${after.skillIds.size}`);
console.log(`Engine cards: ${Object.keys(before.names.card).length} → ${Object.keys(after.names.card).length}`);
for (const [id, [title, charaId, uniqueId]] of Object.entries(after.names.card)) {
  if (Object.hasOwn(before.names.card, id)) continue;
  const name = after.names.chara[charaId] ?? `Chara ${charaId}`;
  const unique = after.names.skill[uniqueId]?.[0] ?? `Skill ${uniqueId}`;
  console.log(`  ${name} ${title} (${id}) · ${unique} (${uniqueId})`);
}
console.log('Replay check from the fork checkout:');
console.log('  cargo run --locked --release --bin compare -- --corpus "<path to Hachimi race logs>"');
if (flag) await refreshGameTora();
