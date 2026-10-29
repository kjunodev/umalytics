import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../packages/ui/src/', import.meta.url));
const require = createRequire(new URL('../apps/extension/package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? sourceFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

function evaluate(file, imports = require) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  vm.runInNewContext(output, { exports, require: imports });
  return exports;
}

test('shared UI source has no browser APIs or extension imports', () => {
  for (const file of sourceFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /browser\.|chrome\.|\bwxt\b|window\.browser/, file);
    if (!/\.tsx?$/.test(file)) continue;
    const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const node of syntax.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith('.')) {
        assert.ok(path.resolve(path.dirname(file), specifier).startsWith(root), `${file}: ${specifier}`);
      } else {
        assert.match(specifier, /^(?:react(?:\/|$)|@umalytics\/(?:core|shared)(?:\/|$))/, `${file}: ${specifier}`);
      }
    }
  }
});

const { UiServicesProvider, useUiServices } = evaluate(path.join(root, 'services.tsx'));
const Probe = () => React.createElement('span', null, useUiServices().name);

test('shared views require an explicit services provider', () => {
  assert.throws(() => renderToStaticMarkup(React.createElement(Probe)), /UiServicesProvider is required/);
});

test('services providers isolate host services and restore the surrounding host', () => {
  const provider = (name, ...children) => React.createElement(UiServicesProvider, { services: { name } }, ...children);
  const html = renderToStaticMarkup(provider('extension', React.createElement(Probe),
    provider('another host', React.createElement(Probe)), React.createElement(Probe)));
  assert.equal(html, '<span>extension</span><span>another host</span><span>extension</span>');
});

test('extension services use the existing transport and storage functions unchanged', () => {
  const methods = ['loadHistoricalMatch', 'loadExplorerProfiles', 'loadSeasonLeaderboard', 'searchPlayers',
    'cancelPlayerHistoryPageRequest', 'cancelPlayerProfileRequest', 'sendPlayerHistoryPageRequest',
    'sendPlayerProfileRequest', 'getRecentPlayers', 'setRecentPlayers'];
  const existing = Object.fromEntries(methods.map(name => [name, () => {}]));
  const { extensionUiServices } = evaluate(new URL('../apps/extension/ui/services.ts', import.meta.url), () => existing);
  assert.deepEqual(Object.keys(extensionUiServices).sort(), methods.sort());
  for (const method of methods) assert.equal(extensionUiServices[method], existing[method], method);
});
