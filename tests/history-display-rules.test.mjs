import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadFunction, parseTsxModule } from './support/harness.mjs';

const ROOT = fileURLToPath(new URL('../apps/extension/', import.meta.url));
const FORBIDDEN = /historyDerived|recentForm|EstimatedChip|buildStatsSummaryFromHistory|buildUmaEntriesFromHistory|fetchBatchPlayerProfileSummaries|\/batch\?|__UMALYTICS_[A-Z_]*PROFILE_DATA__/i;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return ['node_modules', '.output', '.wxt'].includes(entry.name) ? [] : sourceFiles(path.join(dir, entry.name));
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : [];
  });
}

test('extension source displays history without converting it to ranked statistics', () => {
  for (const file of sourceFiles(ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, FORBIDDEN, path.relative(ROOT, file));
  }
  const config = fs.readFileSync(path.join(ROOT, 'wxt.config.ts'), 'utf8');
  assert.match(config, /name: 'UmaLytics'/);
  assert.match(config, /version_name: '0\.5\.0'/);
  assert.match(config, /id: 'umalytics@kjunodev'/);
});

test('loading match history changes display fields only', () => {
  const c = vm.createContext({ RECENT_HISTORY_DISPLAY_MATCHES: 5 });
  loadFunction(c, parseTsxModule('uiPlayerProfileDisplay'), 'withDetailHistory');
  const profile = { discordId: '123456789012345678', wins: 4, losses: 2, matches: 6, pointsPerGame: 8, statsPrivate: true };
  const result = c.withDetailHistory(profile, [{ matchId: 'M1', verificationState: 'confirmed', isWinner: true, pointsScored: 12 }], 1);
  for (const key of ['wins', 'losses', 'matches', 'pointsPerGame', 'statsPrivate']) assert.equal(result[key], profile[key]);
  assert.equal(result.recentMatches.length, 1);
  assert.equal(result.historyTotal, 1);
});
