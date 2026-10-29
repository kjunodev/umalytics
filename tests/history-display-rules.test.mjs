import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { loadFunction, loadModule, parseTsxModule } from './support/harness.mjs';

const ROOT = fileURLToPath(new URL('../apps/extension/', import.meta.url));
const UI = fileURLToPath(new URL('../packages/ui/src/', import.meta.url));
const CORE = fileURLToPath(new URL('../packages/core/src/', import.meta.url));
const DESKTOP = fileURLToPath(new URL('../apps/desktop/src/', import.meta.url));
const FORBIDDEN = /historyDerived|recentForm|EstimatedChip|buildStatsSummaryFromHistory|buildUmaEntriesFromHistory|fetchBatchPlayerProfileSummaries|\/batch\?|__UMALYTICS_[A-Z_]*PROFILE_DATA__/i;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return ['node_modules', '.output', '.wxt'].includes(entry.name) ? [] : sourceFiles(path.join(dir, entry.name));
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : [];
  });
}

test('extension, desktop and shared source display history without converting it to ranked statistics', () => {
  for (const file of [...sourceFiles(ROOT), ...sourceFiles(CORE), ...sourceFiles(UI), ...sourceFiles(DESKTOP)]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, FORBIDDEN, path.relative(ROOT, file));
  }
  const config = fs.readFileSync(path.join(ROOT, 'wxt.config.ts'), 'utf8');
  assert.match(config, /name: 'UmaLytics'/);
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(config.match(/version_name: '([^']+)'/)?.[1], version);
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

const hiddenStatsPlayer = {
  discordId: '123456789012345678', statsPrivate: true, statsScope: 'currentSeason', fetchedAt: 1, profileUrl: '',
  rank: null, matches: null, wins: null, losses: null, winRate: null, pointsPerGame: null, mvpMatches: null,
  topUmas: [], bestUmas: [], allUmas: [], recentMatches: []
};
const loadedHistory = [
  { matchId: 'M1', verificationState: 'confirmed', isWinner: true, pointsScored: 12 },
  { matchId: 'M2', verificationState: 'confirmed', isWinner: false, pointsScored: 3 }
];

test('a hidden-stats player keeps the Private badge after match history loads', () => {
  const c = vm.createContext({ RECENT_HISTORY_DISPLAY_MATCHES: 5 });
  loadModule(c, 'uiCommonBadges');
  loadFunction(c, parseTsxModule('uiPlayerProfileDisplay'), 'withDetailHistory');
  const kinds = profile => Array.from(c.getNotableBadges(profile), badge => badge.kind);
  const before = kinds(hiddenStatsPlayer);
  const withHistory = c.withDetailHistory(hiddenStatsPlayer, loadedHistory, 2);
  assert.equal(withHistory.recentMatches.length, 2);
  assert.deepEqual(before, ['private']);
  assert.deepEqual(kinds(withHistory), before);
  assert.equal(c.hasDisplayableProfileLists(withHistory), false, 'history rows are not displayable ranked stats');
});

test('history rows never make a hidden-stats profile count as having usable ranked stats', () => {
  const c = vm.createContext({});
  loadModule(c, 'profileStates');
  const withHistory = { ...hiddenStatsPlayer, recentMatches: loadedHistory };
  assert.equal(c.hasUsableProfileStats(withHistory), false);
  assert.equal(c.getProfileLoadStatus(withHistory), 'private');
});

// Any value built by withDetailHistory carries display-only history. It may be
// rendered, but must never reach a function that decides badges, privacy or
// card state, or history would decide them.
test('UI code never passes a history-merged profile to badge or privacy decisions', () => {
  const DECISIONS = new Set(['getNotableBadges', 'hasDisplayableProfileLists', 'hasUsableProfileStats', 'getCardState',
    'getProfileDataStatus', 'getStatsMessage', 'getPlayerNote', 'getProfileLoadStatus']);
  const offenders = [];
  for (const file of [...sourceFiles(path.join(ROOT, 'ui')), ...sourceFiles(UI), ...sourceFiles(DESKTOP)]) {
    const syntax = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const tainted = new Set();
    const collect = node => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name) &&
          /\bwithDetailHistory\s*\(/.test(node.initializer.getText(syntax))) tainted.add(node.name.text);
      ts.forEachChild(node, collect);
    };
    collect(syntax);
    const check = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && DECISIONS.has(node.expression.text)) {
        for (const argument of node.arguments) {
          const text = argument.getText(syntax);
          if (/\bwithDetailHistory\s*\(/.test(text) || [...tainted].some(name => new RegExp(`\\b${name}\\b`).test(text))) {
            offenders.push(`${path.relative(ROOT, file)}: ${node.getText(syntax)}`);
          }
        }
      }
      ts.forEachChild(node, check);
    };
    check(syntax);
  }
  assert.deepEqual(offenders, []);
});
