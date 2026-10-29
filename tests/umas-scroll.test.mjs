import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../packages/ui/src/umas/umas.css', import.meta.url), 'utf8');
const rule = selector => {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `rule for ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};

test('Umas scene bounds the page height so only the catalog grid scrolls', () => {
  const shell = rule('.app-shell:has(.umas-scene)');
  // Root zoom (--ui-scale) does not scale viewport units, so the height is divided by it.
  assert.match(shell, /height:\s*calc\(100vh\s*\/\s*var\(--ui-scale\)\)/);
  assert.match(shell, /--umas-scene-min-height:\s*480px/);
  assert.match(rule('.umas-scene'), /flex:\s*1 1 0/);
  assert.match(rule('.umas-layout'), /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(rule('.uma-catalog-panel'), /grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
  assert.match(rule('.uma-catalog-grid'), /overflow-y:\s*auto/);
  assert.match(css, /\.uma-detail-panel \{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\)/);
  assert.match(css, /\.uma-detail-team-grid \{ min-height: 0; overflow-y: auto;/);
});

test('Umas scene stops shrinking at its minimum height and covers History mode', () => {
  const chain = css.slice(css.indexOf('.app-shell:has(.umas-scene) > .app-scene-area:has(.umas-scene)'));
  assert.match(chain, /min-height:\s*var\(--umas-scene-min-height\)/);
  assert.match(chain, /\.explorer-view:has\(\.umas-scene\)/);
  assert.match(chain, /\.history-scene:has\(\.umas-scene\)/);
});

test('the bounded height only applies while the Umas scene is on screen', () => {
  for (const file of ['shell/shell.css', 'lobby/lobby.css', 'draft/draft.css', 'players/players.css']) {
    const other = fs.readFileSync(new URL(file.startsWith('shell/') ? `../apps/extension/ui/${file}` : `../packages/ui/src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(other, /umas-scene|--umas-scene-min-height/, file);
  }
  assert.doesNotMatch(css, /^\.app-shell \{/m);
});
