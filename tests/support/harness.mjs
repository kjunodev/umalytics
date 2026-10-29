import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Source files exercised by the test suite, keyed by stable logical names.
// Paths are relative to the workspace root, including the portable core.
export const MODULES = {
  corePlatform: 'packages/core/src/platform.ts',
  background: 'apps/extension/entrypoints/background.ts',
  content: 'apps/extension/entrypoints/content.ts',
  scoutApp: 'apps/extension/entrypoints/scout/App.tsx',
  uiCommonTokensCss: 'packages/ui/src/common/tokens.css',
  uiCommonBaseCss: 'packages/ui/src/common/base.css',
  uiCommonHeaderLayout: 'packages/ui/src/common/headerLayout.ts',
  uiCommonUiSize: 'apps/extension/ui/common/uiSize.ts',
  uiShellCss: 'apps/extension/ui/shell/shell.css',
  uiLobbyCss: 'packages/ui/src/lobby/lobby.css',
  uiDraftCss: 'packages/ui/src/draft/draft.css',
  uiUmasCss: 'packages/ui/src/umas/umas.css',
  uiHistoryCss: 'packages/ui/src/history/history.css',
  diagnosticRecorder: 'apps/extension/runtime/diagnosticRecorder.ts',
  domLobbyExtraction: 'apps/extension/room/domLobbyExtraction.ts',
  draftExtraction: 'apps/extension/room/draftExtraction.ts',
  explorerClient: 'apps/extension/explorer/explorerClient.ts',
  explorerData: 'packages/core/src/explorer/explorerData.ts',
  explorerService: ['packages/core/src/explorer/explorerService.ts', 'apps/extension/explorer/explorerService.ts'],
  explorerState: 'packages/ui/src/history/explorerState.ts',
  explorerTypes: 'packages/core/src/explorer/explorerTypes.ts',
  matchDetection: 'packages/core/src/room/matchDetection.ts',
  pageHookRuntime: 'apps/extension/room/pageHookRuntime.ts',
  playerExtraction: 'packages/core/src/room/playerExtraction.ts',
  recordReaders: 'packages/core/src/room/recordReaders.ts',
  // A list is evaluated as one module, so playerProfileApi keeps exposing every
  // function and the request/pacing state the tests read, whichever file defines it.
  playerProfileApi: ['packages/core/src/profiles/apiClient.ts', 'packages/core/src/profiles/profileApiMapping.ts', 'packages/core/src/profiles/playerProfileApi.ts'],
  esportsTeamApi: 'packages/core/src/profiles/esportsTeamApi.ts',
  teamIconStorage: 'apps/extension/storage/teamIconStorage.ts',
  profileAvailability: 'packages/core/src/profiles/profileAvailability.ts',
  profileCache: 'packages/core/src/profiles/profileCache.ts',
  profileConstants: 'packages/core/src/profiles/profileConstants.ts',
  profileMerge: 'packages/core/src/profiles/profileMerge.ts',
  profileStorage: 'packages/core/src/storage/profileStorage.ts',
  profileTiming: 'packages/core/src/profiles/profileTiming.ts',
  requestQueue: 'packages/core/src/profiles/requestQueue.ts',
  roomEvents: 'packages/core/src/room/roomEvents.ts',
  rosterDisplay: 'packages/core/src/room/rosterDisplay.ts',
  rosterIdentity: 'packages/core/src/room/rosterIdentity.ts',
  syncPayload: 'packages/core/src/room/syncPayload.ts',
  teams: 'packages/core/src/room/teams.ts',
  textCleanup: 'packages/core/src/room/textCleanup.ts',
  umaPortraitMap: 'packages/core/src/umas/umaPortraitMap.ts',
  umaPortraits: 'packages/core/src/umas/umaPortraits.ts',
  umaReleaseOrder: 'packages/core/src/umas/umaReleaseOrder.ts',

  // ui
  uiScoutData: 'apps/extension/ui/scoutData.ts',
  uiCommonFormat: 'packages/ui/src/common/format.ts',
  uiCommonUmaImage: 'packages/ui/src/common/UmaImage.tsx',
  uiCommonBadges: 'packages/ui/src/common/badges.ts',
  uiCommonPartyVisuals: 'packages/ui/src/common/partyVisuals.ts',
  uiCommonRoster: 'packages/ui/src/common/roster.ts',
  uiPlayerProfileDisplay: 'packages/ui/src/player/playerProfileDisplay.tsx',
  uiPlayerTopUmasList: 'packages/ui/src/player/TopUmasList.tsx',
  uiPlayerBestUmaPortrait: 'packages/ui/src/player/BestUmaPortrait.tsx',
  uiPlayerRecentMatchFormat: 'packages/ui/src/player/recentMatchFormat.ts',
  uiLobbyTeamSection: 'packages/ui/src/lobby/TeamSection.tsx',
  uiLobbyBadgeChip: 'packages/ui/src/lobby/BadgeChip.tsx',
  uiCommonTeamIcon: 'packages/ui/src/common/TeamIcon.tsx',
  uiCommonTooltipPlacement: 'packages/ui/src/common/tooltipPlacement.ts',
  uiPlayerDrawer: 'packages/ui/src/player/PlayerDrawer.tsx',
  uiPlayerDrawerCss: 'packages/ui/src/player/playerDrawer.css',
  uiDraftScene: 'packages/ui/src/draft/DraftScene.tsx',
  uiDraftFormat: 'packages/ui/src/draft/draftFormat.ts',
  uiUmasCatalog: 'packages/ui/src/umas/umaCatalog.ts',
  uiUmasScene: 'packages/ui/src/umas/UmasScene.tsx',
  uiHistoryScene: 'packages/ui/src/history/HistoricalScene.tsx',
  uiHistoryExplorerViews: 'packages/ui/src/history/ExplorerViews.tsx',
  uiPlayersData: 'packages/ui/src/players/playersData.ts',
  uiPlayersView: 'packages/ui/src/players/PlayersView.tsx',
  uiPlayersCss: 'packages/ui/src/players/players.css',
  storagePlayersRecent: 'apps/extension/storage/playersRecentStorage.ts',

  // background
  profileStates: 'apps/extension/background/profileStates.ts',
  scoutWindow: 'apps/extension/background/scoutWindow.ts',
  drafterTabs: 'apps/extension/background/drafterTabs.ts',
  teamIcons: 'apps/extension/background/teamIcons.ts',
};

const pathByName = new Map(Object.entries(MODULES));

// Dependencies each module needs evaluated into the same vm context first,
// matching the preload order the original per-test-file loaders hard coded.
const PRELOADS = {
  profileStorage: ['corePlatform'],
  background: ['profileStates', 'scoutWindow', 'drafterTabs', 'profileConstants', 'recordReaders', 'rosterIdentity'],
  playerProfileApi: ['corePlatform', 'recordReaders', 'rosterIdentity'],
  profileStates: ['recordReaders', 'rosterIdentity'],
  roomEvents: ['rosterIdentity'],
  uiScoutData: ['recordReaders'],
  profileCache: ['profileMerge'],
  explorerState: ['profileMerge'],
  explorerService: ['profileMerge'],
  content: ['roomEvents', 'rosterIdentity', 'recordReaders'],
  domLobbyExtraction: ['recordReaders', 'teams'],
  draftExtraction: ['recordReaders', 'teams'],
  playerExtraction: ['recordReaders', 'rosterIdentity'],
  recordReaders: ['teams'],
  rosterDisplay: ['teams', 'rosterIdentity'],
  uiCommonRoster: ['teams'],
  uiCommonBadges: ['uiCommonFormat', 'profileConstants'],
  uiCommonUiSize: ['uiCommonHeaderLayout'],
  umaPortraits: ['umaPortraitMap', 'umaReleaseOrder'],
};

function resolvePaths(name) {
  if (!pathByName.has(name)) throw new Error(`Unknown module: ${name}`);
  return [pathByName.get(name)].flat();
}

export function readModule(name) {
  return resolvePaths(name).map(relPath => fs.readFileSync(path.join(root, relPath), 'utf8')).join('\n');
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
    .replace('const DEFAULT_REQUEST_INTERVAL_MS = 350;', 'const DEFAULT_REQUEST_INTERVAL_MS = 1;');
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
  if (name === 'corePlatform') context.configureCorePlatform({ storage: context.browser?.storage, recordDiagnostic: context.recordDiagnostic });
}

// Strips imports/exports and evaluates the source through the TypeScript
// compiler instead of stripTypeScriptTypes. Used by recent-history.
export function loadModuleTS(context, name) {
  if (!trackLoad(context, name, false)) return;
  for (const dep of PRELOADS[name] ?? []) loadModuleTS(context, dep);
  const source = stripImportsAndExports(readModule(name));
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(output, context);
  if (name === 'corePlatform') context.configureCorePlatform({ storage: context.browser?.storage, recordDiagnostic: context.recordDiagnostic });
}

// Parses a .tsx module once so individual function declarations can be
// extracted and evaluated in isolation.
export function parseTsxModule(name) {
  return ts.createSourceFile(path.basename(resolvePaths(name)[0]), readModule(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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
