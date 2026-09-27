// pnpm package:release — builds Chromium and Firefox, then packages both into
// versioned ZIPs under downloads/<version>/<label>/ with a SHA256SUMS.txt.
// Verifies every archive entry against its build folder by SHA-256. Refuses
// to overwrite an existing output. Node-only: no PowerShell 7 dependency.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const extension = path.join(root, 'apps', 'extension');

function readConfigField(field, pattern) {
  const config = fs.readFileSync(path.join(extension, 'wxt.config.ts'), 'utf8');
  const match = config.match(pattern);
  if (!match) throw new Error(`Missing ${field} in wxt.config.ts`);
  return match[1];
}

const version = readConfigField('version', /\bversion:\s*'([^']+)'/);
const versionName = readConfigField('version_name', /\bversion_name:\s*'([^']+)'/);
const label = versionName;

const outputRoot = path.join(root, 'downloads', version, label);
const families = [
  { name: 'chromium', folder: 'chrome-mv3' },
  { name: 'firefox', folder: 'firefox-mv3' }
];
const zips = families.map(family => ({
  ...family,
  zip: path.join(outputRoot, `umalytics-${family.name}-${label}.zip`)
}));
const sumsPath = path.join(outputRoot, 'SHA256SUMS.txt');
for (const target of [...zips.map(z => z.zip), sumsPath]) {
  if (fs.existsSync(target)) throw new Error(`Refusing to overwrite: ${target}`);
}

console.log(`Building ${version} (${label})...`);
const build = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-all.mjs')], { cwd: root, stdio: 'inherit' });
if (build.error || build.status !== 0) throw build.error ?? new Error('pnpm build:all failed');

const extensionOutput = path.join(extension, '.output');
const sourcesByFamily = new Map(families.map(family => [family.name, path.join(extensionOutput, family.folder)]));

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(entryPath));
    else results.push(entryPath);
  }
  return results;
}

function createZip(sourceDir, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "$ErrorActionPreference='Stop'; Compress-Archive -Path (Join-Path $env:UMALYTICS_ZIP_SOURCE '*') -DestinationPath $env:UMALYTICS_ZIP_DESTINATION"],
      { stdio: 'inherit', env: { ...process.env, UMALYTICS_ZIP_SOURCE: sourceDir, UMALYTICS_ZIP_DESTINATION: zipPath } });
  } else {
    execFileSync('zip', ['-qr', zipPath, '.'], { cwd: sourceDir, stdio: 'inherit' });
  }
}

function verifyZip(sourceDir, zipPath) {
  const listDir = fs.mkdtempSync(path.join(os.tmpdir(), 'umalytics-verify-'));
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', ['-NoProfile', '-Command',
        "$ErrorActionPreference='Stop'; Expand-Archive -Path $env:UMALYTICS_ZIP_SOURCE -DestinationPath $env:UMALYTICS_ZIP_DESTINATION"],
        { stdio: 'inherit', env: { ...process.env, UMALYTICS_ZIP_SOURCE: zipPath, UMALYTICS_ZIP_DESTINATION: listDir } });
    } else {
      execFileSync('unzip', ['-q', zipPath, '-d', listDir], { stdio: 'inherit' });
    }
    const manifestPath = path.join(listDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`Root manifest missing: ${zipPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== 'UmaLytics') throw new Error(`Manifest name mismatch: ${zipPath}`);

    const sourceFiles = listFiles(sourceDir);
    const extractedFiles = listFiles(listDir);
    if (sourceFiles.length !== extractedFiles.length) throw new Error(`File count mismatch: ${zipPath}`);

    const seen = new Set();
    for (const sourceFile of sourceFiles) {
      const relative = path.relative(sourceDir, sourceFile).split(path.sep).join('/');
      if (seen.has(relative)) throw new Error(`Duplicate archive entry: ${relative}`);
      seen.add(relative);
      const extractedFile = path.join(listDir, relative);
      if (!fs.existsSync(extractedFile)) throw new Error(`Unexpected archive entry missing: ${relative}`);
      if (sha256File(sourceFile) !== sha256File(extractedFile)) throw new Error(`File hash mismatch: ${relative}`);
    }
  } finally {
    fs.rmSync(listDir, { recursive: true, force: true });
  }
}

const sums = [];
for (const target of zips) {
  const source = sourcesByFamily.get(target.name);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.name !== 'UmaLytics' || manifest.version !== version) throw new Error(`Manifest identity mismatch: ${source}`);
  if (target.name === 'chromium' && (manifest.version_name ?? manifest.version) !== label) throw new Error(`Version name mismatch: ${source}`);
  if (target.name === 'firefox' && manifest.browser_specific_settings?.gecko?.id !== 'umalytics@kjunodev') throw new Error(`Firefox ID mismatch: ${source}`);

  createZip(source, target.zip);
  verifyZip(source, target.zip);
  const zipHash = sha256File(target.zip);
  sums.push(`${zipHash}  ${path.basename(target.zip)}`);
  console.log(`${target.name}: ${listFiles(source).length} files, SHA-256 ${zipHash}`);
}
fs.writeFileSync(sumsPath, sums.join('\n') + '\n');
console.log(`Checksums: ${sumsPath}`);
