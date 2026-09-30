import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { loadModule, readModule } from './support/harness.mjs';

function harness(stored) {
  const data = { scoutUiSize: stored };
  const writes = [];
  const document = { documentElement: { dataset: {} } };
  const c = vm.createContext({ document, browser: { storage: { local: {
    get: async () => data,
    set: async value => { writes.push(value); Object.assign(data, value); }
  } } } });
  loadModule(c, 'uiCommonUiSize');
  return { c, data, writes, document };
}

const WIDE = 2000;

test('first launch picks the UI size at the exact height boundaries and stores it', async () => {
  for (const [height, expected] of [[720, 'small'], [759, 'small'], [760, 'default'], [1200, 'default'], [1201, 'large']]) {
    const { c, data, writes, document } = harness();
    assert.equal(await c.initializeUiSize(height, WIDE), expected);
    assert.equal(data.scoutUiSize, expected);
    assert.equal(document.documentElement.dataset.uiSize, expected);
    assert.equal(writes.length, 1);
  }
});

test('stored preferences survive reopening at any height and are never automatically changed', async () => {
  for (const stored of ['small', 'default', 'large']) {
    const { c, writes } = harness(stored);
    for (const height of [500, 900, 1500]) for (const width of [700, WIDE]) assert.equal(await c.initializeUiSize(height, width), stored);
    assert.equal(writes.length, 0);
  }
  assert.doesNotMatch(readModule('uiCommonUiSize'), /addEventListener|ResizeObserver/);
});

test('a manual choice persists and overrides the first-launch choice on later launches', async () => {
  const { c, data, document } = harness();
  await c.initializeUiSize(720, WIDE);
  await c.saveUiSize('large');
  assert.equal(data.scoutUiSize, 'large');
  assert.equal(document.documentElement.dataset.uiSize, 'large');
  assert.equal(await c.initializeUiSize(720, WIDE), 'large');
  assert.equal(await harness(data.scoutUiSize).c.initializeUiSize(500, 700), 'large');
});

test('invalid stored values are replaced by a valid first-launch size', async () => {
  const { c, data } = harness('giant');
  assert.equal(await c.initializeUiSize(900, WIDE), 'default');
  assert.equal(data.scoutUiSize, 'default');
});

test('first launch steps the UI size down so the header never starts on two rows', async () => {
  // Minimum window width at which each size's header still fits on one row:
  // (width - 15px gutter) / scale - 74px of shell and header padding >= 760px.
  const pick = async (height, width) => harness().c.initializeUiSize(height, width);
  assert.equal(await pick(1300, 2000), 'large');
  assert.equal(await pick(1300, 975), 'large');
  assert.equal(await pick(1300, 974), 'default');
  assert.equal(await pick(1300, 849), 'default');
  assert.equal(await pick(1300, 848), 'small');
  assert.equal(await pick(900, 2000), 'default');
  assert.equal(await pick(900, 849), 'default');
  assert.equal(await pick(900, 848), 'small');
  assert.equal(await pick(900, 745), 'small');
  assert.equal(await pick(700, 2000), 'small');
  assert.equal(await pick(1300, 500), 'small');
  // Sean's 1255px laptop window at 125% scaling is about 1000 CSS px wide.
  assert.equal(await pick(800, 1000), 'default');
  assert.equal(await pick(1300, 1000), 'large');
});

test('the header container thresholds match the layout constants', () => {
  const c = vm.createContext({});
  loadModule(c, 'uiCommonHeaderLayout');
  const full = vm.runInContext('HEADER_FULL_MIN_WIDTH', c);
  const compact = vm.runInContext('HEADER_COMPACT_MIN_WIDTH', c);
  const shell = readModule('uiShellCss');
  const queries = [...shell.matchAll(/@container header \(width < (\d+)px\)/g)].map(match => Number(match[1]));
  assert.deepEqual(queries, [full, compact]);
  assert(compact < full);
  // Zoom-blind viewport media queries must not drive the header.
  assert.doesNotMatch(shell, /@media[^{]*(900|1040)px/);
  assert.match(shell, /\.app-header\s*\{[^}]*container:\s*header \/ inline-size/s);
  assert.match(shell, /\.app-menu\s*\{[^}]*max-width:\s*100cqw/s);
  assert.doesNotMatch(shell, /flex-wrap:\s*wrap/);
  assert.equal(vm.runInContext('headerStateForWidth(984)', c), 'compact');
  assert.equal(vm.runInContext('headerStateForWidth(985)', c), 'full');
  assert.equal(vm.runInContext('headerStateForWidth(759)', c), 'two-row');
});

test('both entrypoints load the preference before mounting the UI', () => {
  for (const path of ['entrypoints/scout/main.tsx', 'dev/preview/main.tsx']) {
    const source = fs.readFileSync(new URL(`../apps/extension/${path}`, import.meta.url), 'utf8');
    assert.match(source, /function mount\(\)/);
    assert.match(source, /initializeUiSize\(window.innerHeight, window.innerWidth\)[\s\S]*\.then\(mount\)/);
    assert.match(source, /initialUiSize\(window.innerHeight, window.innerWidth\)/);
  }
});

test('desktop sizing uses fixed tokens and natural height, with width-only column changes', () => {
  const tokens = readModule('uiCommonTokensCss');
  const base = readModule('uiCommonBaseCss');
  const lobby = readModule('uiLobbyCss');
  const draft = readModule('uiDraftCss');
  const drawer = readModule('uiPlayerDrawerCss');
  const shell = readModule('uiShellCss');
  for (const css of [tokens, base, lobby, draft, drawer, shell]) {
    assert.doesNotMatch(css, /clamp\(|\bcqh\b|\bcqw\b|data-height-tier|container-type:\s*size/);
  }
  assert.match(base, /grid-template-rows:\s*repeat\(3, 40px\)/);
  assert.match(base, /\.best-uma-portrait\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px/s);
  assert.match(base, /zoom:\s*var\(--ui-scale\)/);
  assert.match(tokens, /--row-md:\s*44px/);
  assert.match(tokens, /--row-lg:\s*46px/);
  assert.match(tokens, /--row-sm:\s*30px/);
  assert.match(tokens, /--pick-tile-height:\s*128px/);
  for (const width of [660, 880, 1100]) assert(lobby.includes(`min-width: ${width}px`));
  assert.match(draft, /@container scene \(max-width: 1099px\)/);
  assert.match(draft, /\.draft-pick-portrait\s*\{[^}]*height:\s*64px/s);
  assert.match(drawer, /\.player-drawer\s*\{[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(shell, /height:\s*100vh|overflow:\s*hidden/);
});
