import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const extension = path.join(root, 'apps', 'extension');
const cli = path.join(extension, 'node_modules', 'wxt', 'bin', 'wxt.mjs');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const releaseRoot = path.join(root, '.releases', `${version}-${Date.now()}`);
const builds = [];
for (const mode of ['public']) {
  for (const browser of ['chrome', 'firefox']) {
    const result = spawnSync(process.execPath, [cli, 'build', '--browser', browser], {
      cwd: extension,
      env: { ...process.env, UMALYTICS_PRIVATE_PROFILE_DATA: String(mode === 'private') },
      stdio: 'inherit'
    });
    if (result.error || result.status !== 0) throw result.error ?? new Error(`${mode}/${browser} build failed`);
    const output = path.join(extension, '.output', `${browser}-mv3`);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    const background = fs.readFileSync(path.join(output, 'background.js'), 'utf8');
    // WXT omits Chromium's version_name from Firefox manifests.
    if (manifest.version !== version || (browser === 'chrome' && manifest.version_name !== `${version}-${mode}.open-beta.1`)) throw new Error('Version mismatch');
    if (manifest.name !== (mode === 'private' ? 'UmaLytics Private' : 'UmaLytics')) throw new Error('Build mode mismatch');
    if (background.includes('/history?') !== (mode === 'private')) throw new Error('Private-history boundary check failed');
    if (browser === 'firefox' && manifest.browser_specific_settings.gecko.id !==
      (mode === 'private' ? 'umalytics-private@kjunodev' : 'umalytics@kjunodev')) throw new Error('Firefox ID mismatch');
    const family = browser === 'chrome' ? 'chromium' : 'firefox';
    const destination = path.join(releaseRoot, `${mode}-${family}`);
    fs.cpSync(output, destination, { recursive: true });
    builds.push({ mode, family, path: destination });
  }
}
fs.writeFileSync(path.join(root, '.releases', 'latest.json'), JSON.stringify({ version, builds }, null, 2));
console.log(`Public Chromium and Firefox builds verified: ${releaseRoot}`);
