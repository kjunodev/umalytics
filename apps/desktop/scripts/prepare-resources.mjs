import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const native = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', path.join(native, 'Cargo.toml')], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const manifest = await readFile(path.join(native, 'Cargo.toml'), 'utf8');
const revision = manifest.match(/uma_race_sim\s*=.*rev\s*=\s*"([a-f0-9]+)"/)?.[1];
const engine = metadata.packages.find(pkg => pkg.name === 'uma_race_sim' && pkg.source?.endsWith(`#${revision}`));
if (!engine) throw new Error('Pinned uma_race_sim checkout was not found in cargo metadata');
const destination = path.join(native, 'resources/engine-data');
// Start clean so files removed from the pinned engine data never linger in a bundle.
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
// Ship every data era and skill history; no assumptions about engine reads.
await cp(path.join(path.dirname(engine.manifest_path), 'data'), destination, { recursive: true, force: true });
// Keep the tracked placeholder: Tauri requires this folder to exist even for dev and test builds.
await writeFile(path.join(destination, '.gitkeep'), '');
console.log('Prepared bundled engine data from pinned cargo dependency');
