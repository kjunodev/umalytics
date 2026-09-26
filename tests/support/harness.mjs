import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../apps/extension/', import.meta.url));

// Every extension source file exercised by the test suite, keyed by a stable
// logical name. Centralizing this list means a future move of these files
// (e.g. utils/ into room/ storage/ profiles/ explorer/ umas/ runtime/) only
// requires updating the paths below, not every test file that loads them.
export const MODULES = {
  background: 'entrypoints/background.ts',
  content: 'entrypoints/content.ts',
  pageHook: 'entrypoints/pageHook.ts',
  scoutApp: 'entrypoints/scout/App.tsx',
  uiCommonTokensCss: 'ui/common/tokens.css',
  uiCommonBaseCss: 'ui/common/base.css',
  uiShellCss: 'ui/shell/shell.css',
  uiLobbyCss: 'ui/lobby/lobby.css',
  uiDraftCss: 'ui/draft/draft.css',
  uiUmasCss: 'ui/umas/umas.css',
  uiHistoryCss: 'ui/history/history.css',
  diagnosticRecorder: 'runtime/diagnosticRecorder.ts',
  domLobbyExtraction: 'room/domLobbyExtraction.ts',
  draftExtraction: 'room/draftExtraction.ts',
  explorerClient: 'explorer/explorerClient.ts',
  explorerData: 'explorer/explorerData.ts',
  explorerService: 'explorer/explorerService.ts',
  explorerState: 'explorer/explorerState.ts',
  explorerTypes: 'explorer/explorerTypes.ts',
  matchDetection: 'room/matchDetection.ts',
  pageHookRuntime: 'room/pageHookRuntime.ts',
  playerExtraction: 'room/playerExtraction.ts',
  recordReaders: 'room/recordReaders.ts',
  playerProfileApi: 'profiles/playerProfileApi.ts',
  profileAvailability: 'profiles/profileAvailability.ts',
  profileCache: 'profiles/profileCache.ts',
  profileConstants: 'profiles/profileConstants.ts',
  profileMerge: 'profiles/profileMerge.ts',
  profileEstimates: 'profiles/profileEstimates.ts',
  profileStorage: 'storage/profileStorage.ts',
  profileTiming: 'profiles/profileTiming.ts',
  requestQueue: 'profiles/requestQueue.ts',
  roomEvents: 'room/roomEvents.ts',
  rosterDisplay: 'room/rosterDisplay.ts',
  rosterIdentity: 'room/rosterIdentity.ts',
  syncPayload: 'room/syncPayload.ts',
  teams: 'room/teams.ts',
  textCleanup: 'room/textCleanup.ts',
  umaPortraits: 'umas/umaPortraits.ts',
  umaReleaseOrder: 'umas/umaReleaseOrder.ts',

  // ui (phase 2)
  uiScoutData: 'ui/scoutData.ts',
  uiCommonFormat: 'ui/common/format.ts',
  uiCommonUmaImage: 'ui/common/UmaImage.tsx',
  uiCommonBadges: 'ui/common/badges.ts',
  uiCommonPartyVisuals: 'ui/common/partyVisuals.ts',
  uiCommonRoster: 'ui/common/roster.ts',
  uiPlayerProfileDisplay: 'ui/player/playerProfileDisplay.tsx',
  uiPlayerTopUmasList: 'ui/player/TopUmasList.tsx',
  uiPlayerBestUmaPortrait: 'ui/player/BestUmaPortrait.tsx',
  uiPlayerRecentMatchFormat: 'ui/player/recentMatchFormat.ts',
  uiLobbyTeamSection: 'ui/lobby/TeamSection.tsx',
  uiLobbyBadgeChip: 'ui/lobby/BadgeChip.tsx',
  uiPlayerDrawer: 'ui/player/PlayerDrawer.tsx',
  uiPlayerDrawerCss: 'ui/player/playerDrawer.css',
  uiDraftScene: 'ui/draft/DraftScene.tsx',
  uiDraftFormat: 'ui/draft/draftFormat.ts',
  uiUmasCatalog: 'ui/umas/umaCatalog.ts',
  uiUmasPlannerScene: 'ui/umas/UmaPlannerScene.tsx',
  uiHistoryScene: 'ui/history/HistoricalScene.tsx',
  uiHistoryExplorerViews: 'ui/history/ExplorerViews.tsx',
  uiPlayersData: 'ui/players/playersData.ts',
  uiPlayersView: 'ui/players/PlayersView.tsx',
  uiPlayersCss: 'ui/players/players.css',
  storagePlayersRecent: 'storage/playersRecentStorage.ts',

  // background (phase 3)
  profileStates: 'background/profileStates.ts',
  scoutWindow: 'background/scoutWindow.ts',
  drafterTabs: 'background/drafterTabs.ts',
};

const pathByName = new Map(Object.entries(MODULES));

// Dependencies each module needs evaluated into the same vm context first,
// matching the preload order the original per-test-file loaders hard coded.
const PRELOADS = {
  background: ['profileStates', 'scoutWindow', 'drafterTabs', 'profileEstimates', 'profileConstants'],
  profileCache: ['profileMerge'],
  explorerState: ['profileMerge'],
  explorerService: ['profileMerge', 'profileEstimates'],
  pageHook: ['pageHookRuntime'],
  content: ['roomEvents', 'rosterIdentity', 'recordReaders'],
  domLobbyExtraction: ['recordReaders', 'teams'],
  draftExtraction: ['recordReaders', 'teams'],
  playerExtraction: ['recordReaders'],
  recordReaders: ['teams'],
  rosterDisplay: ['teams'],
  uiCommonRoster: ['teams'],
  uiCommonBadges: ['uiCommonFormat', 'profileConstants'],
};

function resolvePath(name) {
  if (!pathByName.has(name)) throw new Error(`Unknown module: ${name}`);
  return pathByName.get(name);
}

export function readModule(name) {
  return fs.readFileSync(path.join(root, resolvePath(name)), 'utf8');
}

function stripImportsAndExports(source) {
  return source
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/^export default /gm, '')
    .replace(/^export /gm, '');
}

function applyFastPatches(source) {
  return source
    .replace(/const API_REQUEST_TIMEOUT_MS = [^;]+;/, 'const API_REQUEST_TIMEOUT_MS = 120;')
    .replace(/const PROFILE_SUMMARY_TIMEOUT_MS = [^;]+;/, 'const PROFILE_SUMMARY_TIMEOUT_MS = 1500;')
    .replace('15_000', '300')
    .replace('const DEFAULT_REQUEST_INTERVAL_MS = 350;', 'const DEFAULT_REQUEST_INTERVAL_MS = 1;')
    .replace('const BATCH_SETTLE_MS = 1200;', 'const BATCH_SETTLE_MS = 10;');
}

const loadedByContext = new WeakMap();

// Returns false if `name` was already loaded in this context with the same
// `fast` flag (a no-op re-load to skip), or throws if it was already loaded
// with a different `fast` flag (an inconsistent re-load, not a safe skip).
function trackLoad(context, name, fast) {
  let seen = loadedByContext.get(context);
  if (!seen) { seen = new Map(); loadedByContext.set(context, seen); }
  if (seen.has(name)) {
    const previous = seen.get(name);
    if (previous !== fast) throw new Error(`Module "${name}" already loaded in this context with fast=${previous}, cannot reload with fast=${fast}`);
    return false;
  }
  seen.set(name, fast);
  return true;
}

// Strips imports/exports and evaluates the source with stripTypeScriptTypes
// in the given vm context. Used by regression, explorer and explorer-transport.
export function loadModule(context, name, options = {}) {
  const fast = Boolean(options.fast);
  if (!trackLoad(context, name, fast)) return;
  for (const dep of PRELOADS[name] ?? []) loadModule(context, dep);
  let source = stripImportsAndExports(readModule(name));
  if (fast) source = applyFastPatches(source);
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), context);
}

// Strips imports/exports and evaluates the source through the TypeScript
// compiler instead of stripTypeScriptTypes. Used by recent-history.
export function loadModuleTS(context, name) {
  if (!trackLoad(context, name, false)) return;
  for (const dep of PRELOADS[name] ?? []) loadModuleTS(context, dep);
  const source = stripImportsAndExports(readModule(name));
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(output, context);
}

// Parses a .tsx module once so individual function declarations can be
// extracted and evaluated in isolation.
export function parseTsxModule(name) {
  const relPath = resolvePath(name);
  return ts.createSourceFile(path.basename(relPath), readModule(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const JSX_COMPILER_OPTIONS = { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'element' };

// Extracts a single named function declaration from a parsed .tsx module and
// evaluates it (JSX-transpiled) in the given vm context. Used by
// recent-history and explorer-scenes.
export function loadFunction(context, syntax, name) {
  const node = syntax.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node) throw new Error(`Function declaration not found: ${name}`);
  const text = node.getText(syntax).replace(/^export\s+/, '');
  const output = ts.transpileModule(text, { compilerOptions: JSX_COMPILER_OPTIONS }).outputText;
  vm.runInContext(output, context);
}
