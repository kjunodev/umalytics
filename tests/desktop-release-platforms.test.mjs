import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../apps/desktop/scripts/release.mjs';

const version = '0.2.0';
const installer = `UmaLytics_${version}_x64-setup.exe`;
const archive = 'UmaLytics_universal.app.tar.gz';
const assets = [installer, `${installer}.sig`, archive, `${archive}.sig`];
const entry = name => ({ signature: 'signed', url: `https://github.com/kjunodev/umalytics/releases/download/desktop-v${version}/${name}` });
const manifest = () => ({ version, notes: 'Release notes', platforms: {
  'windows-x86_64': entry(installer),
  'windows-x86_64-nsis': entry(installer),
} });
const universal = () => ({ ...manifest(), platforms: { ...manifest().platforms,
  'darwin-aarch64': entry(archive), 'darwin-x86_64': entry(archive),
  'darwin-aarch64-app': entry(archive), 'darwin-x86_64-app': entry(archive),
} });

test('desktop updater accepts Windows alone and Windows plus both universal macOS targets', () => {
  validateManifest(manifest(), version, assets);
  validateManifest(universal(), version, assets);
  for (const platform of ['windows-x86_64', 'windows-x86_64-nsis']) {
    validateManifest({ ...manifest(), platforms: { [platform]: entry(installer) } }, version, assets);
  }
});

test('macOS updater rejects another release, missing signatures and non-app archives', () => {
  for (const platform of ['darwin-aarch64', 'darwin-x86_64', 'darwin-aarch64-app', 'darwin-x86_64-app']) {
    for (const change of [
      item => { item.url = item.url.replace('desktop-v0.2.0/', 'desktop-v0.1.0/'); },
      item => { item.signature = ' '; },
      item => { item.url = item.url.replace('.app.tar.gz', '.dmg'); },
    ]) {
      const invalid = universal(); change(invalid.platforms[platform]);
      assert.throws(() => validateManifest(invalid, version, assets), /signed versioned macOS/);
    }
  }
  assert.throws(() => validateManifest(universal(), version, assets.filter(name => name !== `${archive}.sig`)), /signature asset is missing/);
});

test('macOS entries cannot replace or weaken the required signed Windows updater', () => {
  const missing = universal();
  delete missing.platforms['windows-x86_64']; delete missing.platforms['windows-x86_64-nsis'];
  assert.throws(() => validateManifest(missing, version, assets), /Windows NSIS entry/);
  assert.throws(() => validateManifest({ ...missing, platforms: {} }, version, assets), /Windows NSIS entry/);
  for (const platform of ['windows-x86_64', 'windows-x86_64-nsis']) {
    const unsigned = universal(); unsigned.platforms[platform].signature = '';
    assert.throws(() => validateManifest(unsigned, version, assets), /signed versioned NSIS/);
  }
  assert.throws(() => validateManifest(universal(), version, assets.filter(name => name !== `${installer}.sig`)), /signature asset is missing/);
  const unexpected = universal(); unexpected.platforms['linux-x86_64'] = entry(archive);
  assert.throws(() => validateManifest(unexpected, version, assets), /Unexpected updater target/);
});
