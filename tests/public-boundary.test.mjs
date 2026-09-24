import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HISTORY_PATTERN = /fetchPlayerHistory|buildStatsSummaryFromHistory|buildUmaEntriesFromHistory|\/history\?/;
const EXCLUDED_DIRS = new Set(['node_modules', '.output', '.wxt']);

function collectSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...collectSourceFiles(path.join(dir, entry.name)));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

test('community source cannot retrieve or reconstruct hidden profile history',()=>{
 const extensionRoot = fileURLToPath(new URL('../apps/extension/', import.meta.url));
 for (const file of collectSourceFiles(extensionRoot)) {
   const source = fs.readFileSync(file, 'utf8');
   assert(!HISTORY_PATTERN.test(source), `${path.relative(extensionRoot, file)} must not reference private history retrieval`);
 }
 const config=fs.readFileSync(new URL('../apps/extension/wxt.config.ts',import.meta.url),'utf8');
 assert(config.includes('const privateProfileDataBuild = false;'));
 const build=fs.readFileSync(new URL('../scripts/build-all.mjs',import.meta.url),'utf8');
 assert(build.includes("for (const mode of ['public'])"));
});
