import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const extension = path.join(root, 'apps', 'extension');
const cli = path.join(extension, 'node_modules', 'wxt', 'bin', 'wxt.mjs');
const config = fs.readFileSync(path.join(extension, 'wxt.config.ts'), 'utf8');
const readManifestField = (field, pattern) => {
  const match = config.match(pattern);
  if (!match) throw new Error(`Missing ${field} in wxt.config.ts`);
  return match[1];
};
const version = readManifestField('version', /\bversion:\s*'([^']+)'/);
const versionName = readManifestField('version_name', /\bversion_name:\s*'([^']+)'/);
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (packageVersion !== version) throw new Error(`package.json version ${packageVersion} does not match wxt.config.ts version ${version}`);
const releaseRoot = path.join(root, '.releases', `${version}-${Date.now()}`);
const builds = [];

for (const browser of ['chrome', 'firefox']) {
  const result = spawnSync(process.execPath, [cli, 'build', '--browser', browser], {
    cwd: extension,
    stdio: 'inherit'
  });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${browser} build failed`);
  const output = path.join(extension, '.output', `${browser}-mv3`);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  // WXT omits version_name when it equals version.
  if (manifest.version !== version || (browser === 'chrome' && (manifest.version_name ?? manifest.version) !== versionName)) throw new Error('Version mismatch');
  if (manifest.name !== 'UmaLytics') throw new Error('Extension name mismatch');
  if (browser === 'firefox' && manifest.browser_specific_settings?.gecko?.id !== 'umalytics@kjunodev') throw new Error('Firefox ID mismatch');
  const family = browser === 'chrome' ? 'chromium' : 'firefox';
  const destination = path.join(releaseRoot, family);
  fs.cpSync(output, destination, { recursive: true });
  builds.push({ family, path: destination });
}

fs.writeFileSync(path.join(root, '.releases', 'latest.json'), JSON.stringify({ version, builds }, null, 2));
console.log(`Chromium and Firefox builds verified: ${releaseRoot}`);
