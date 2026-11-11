import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const native = fileURLToPath(new URL('../src-tauri/', import.meta.url));
export const engineRevision = /^uma_race_sim\s*=.*\brev\s*=\s*"([a-f0-9]+)"/m;

export async function engineDataDir() {
  const manifestPath = path.join(native, 'Cargo.toml');
  const revision = (await readFile(manifestPath, 'utf8')).match(engineRevision)?.[1];
  if (!revision) throw new Error('Pinned uma_race_sim revision was not found in Cargo.toml');
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', manifestPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  const engine = metadata.packages.find(pkg => pkg.name === 'uma_race_sim' && pkg.source?.endsWith(`#${revision}`));
  if (!engine) throw new Error('Pinned uma_race_sim checkout was not found in cargo metadata');
  return path.join(path.dirname(engine.manifest_path), 'data');
}

export async function prepareResources(source) {
  const destination = path.join(native, 'resources/engine-data');
  // Start clean so files removed from the pinned engine data never linger in a bundle.
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  // Ship every data era and skill history.
  await cp(source, destination, { recursive: true, force: true });
  // Keep the tracked placeholder required by Tauri dev and test builds.
  await writeFile(path.join(destination, '.gitkeep'), '');
  console.log('Prepared bundled engine data from pinned cargo dependency');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareResources(await engineDataDir());
}
