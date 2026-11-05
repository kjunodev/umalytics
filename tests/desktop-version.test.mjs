import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateManifest, validateVersion } from '../apps/desktop/scripts/release.mjs';
import { compare } from '../apps/desktop/scripts/version.mjs';

const read = file => fs.readFileSync(new URL(`../apps/desktop/${file}`, import.meta.url), 'utf8');
export function checkVersions(packageVersion, cargoVersion) {
  assert.equal(cargoVersion, packageVersion, 'Desktop Cargo.toml version must match package.json');
}
test('desktop package is the Tauri version source and Cargo stays in sync', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.equal(JSON.parse(read('src-tauri/tauri.conf.json')).version, '../package.json');
  checkVersions(version, read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)[1]);
  assert.throws(() => checkVersions('0.1.0', '0.2.0'), /must match/);
});
test('release manifest must reference an existing signed installer on the versioned release', () => {
  const installer = 'UmaLytics_0.1.0_x64-setup.exe';
  const assets = [installer, `${installer}.sig`, 'latest.json'];
  const manifest = { version: '0.1.0', notes: 'Notes', platforms: { 'windows-x86_64': { signature: 'signature', url: `https://github.com/kjunodev/umalytics/releases/download/desktop-v0.1.0/${installer}` } } };
  validateManifest(manifest, '0.1.0', assets);
  assert.throws(() => validateManifest(manifest, '0.2.0', assets));
  assert.throws(() => validateManifest(manifest, '0.1.0', [installer]));
  const invalid = structuredClone(manifest); invalid.platforms['windows-x86_64'].url = `https://github.com/kjunodev/umalytics/releases/latest/download/${installer}`;
  assert.throws(() => validateManifest(invalid, '0.1.0', assets));
  assert.throws(() => validateVersion('0.1.0; malicious'));
});
test('feed comparison prevents downgrades, including prereleases', () => {
  for (const [a, b] of [['0.2.0','0.1.9'], ['0.1.0','0.1.0-beta.9'], ['0.1.0-beta.10','0.1.0-beta.2']]) { assert(compare(a, b) > 0); assert(compare(b, a) < 0); }
  assert.equal(compare('0.1.0', '0.1.0'), 0);
});
