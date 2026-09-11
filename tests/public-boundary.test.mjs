import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('community source cannot retrieve or reconstruct hidden profile history',()=>{
 const api=fs.readFileSync(new URL('../apps/extension/utils/playerProfileApi.ts',import.meta.url),'utf8');
 assert(!/fetchPlayerHistory|buildStatsSummaryFromHistory|buildUmaEntriesFromHistory|\/history\?/.test(api));
 const config=fs.readFileSync(new URL('../apps/extension/wxt.config.ts',import.meta.url),'utf8');
 assert(config.includes('const privateProfileDataBuild = false;'));
 const build=fs.readFileSync(new URL('../scripts/build-all.mjs',import.meta.url),'utf8');
 assert(build.includes("for (const mode of ['public'])"));
});
