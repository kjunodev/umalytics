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
  scoutStyles: 'entrypoints/scout/styles.css',
  diagnosticRecorder: 'utils/diagnosticRecorder.ts',
  domLobbyExtraction: 'utils/domLobbyExtraction.ts',
  draftExtraction: 'utils/draftExtraction.ts',
  explorerClient: 'utils/explorerClient.ts',
  explorerData: 'utils/explorerData.ts',
  explorerService: 'utils/explorerService.ts',
  explorerState: 'utils/explorerState.ts',
  explorerTypes: 'utils/explorerTypes.ts',
  matchDetection: 'utils/matchDetection.ts',
  pageHookRuntime: 'utils/pageHookRuntime.ts',
  playerExtraction: 'utils/playerExtraction.ts',
  playerProfileApi: 'utils/playerProfileApi.ts',
  profileAvailability: 'utils/profileAvailability.ts',
  profileCache: 'utils/profileCache.ts',
  profileConstants: 'utils/profileConstants.ts',
  profileMerge: 'utils/profileMerge.ts',
  profileStorage: 'utils/profileStorage.ts',
  profileTiming: 'utils/profileTiming.ts',
  requestQueue: 'utils/requestQueue.ts',
  roomEvents: 'utils/roomEvents.ts',
  rosterDisplay: 'utils/rosterDisplay.ts',
  rosterIdentity: 'utils/rosterIdentity.ts',
  syncPayload: 'utils/syncPayload.ts',
  textCleanup: 'utils/textCleanup.ts',
  umaPortraits: 'utils/umaPortraits.ts',
  umaReleaseOrder: 'utils/umaReleaseOrder.ts',
};

const pathByName = new Map(Object.entries(MODULES));

// Dependencies each module needs evaluated into the same vm context first,
// matching the preload order the original per-test-file loaders hard coded.
const PRELOADS = {
  profileCache: ['profileMerge'],
  explorerState: ['profileMerge'],
  explorerService: ['profileMerge'],
  pageHook: ['pageHookRuntime'],
  content: ['roomEvents', 'rosterIdentity'],
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
    .replace('const DEFAULT_REQUEST_INTERVAL_MS = 500;', 'const DEFAULT_REQUEST_INTERVAL_MS = 1;');
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
  const output = ts.transpileModule(node.getText(syntax), { compilerOptions: JSX_COMPILER_OPTIONS }).outputText;
  vm.runInContext(output, context);
}
