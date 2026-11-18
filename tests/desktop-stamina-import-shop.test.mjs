import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(name, imports = {}) {
  const exports = {};
  const url = new URL(`../apps/desktop/src/${name}.ts`, import.meta.url);
  const compiled = ts.transpileModule(fs.readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: name => imports[name] });
  return exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const guide = load('staminaImportGuide');
const prices = load('staminaScreenshot');
const types = load('staminaTypes');
const shop = load('staminaShop', { './staminaScreenshot': prices, './staminaTypes': types });
const scan = (screen, n = 0, attributes = null) => ({ screen, skills: Array(n).fill({}), attributes });

test('import guide tracks recognized screens and newly found rows independently of capture order', () => {
  const progress = (flow, screens) => plain(guide.importGuideProgress(flow, screens));
  assert.deepEqual(progress('career', []), [false, false, false, false]);
  assert.deepEqual(progress('career', [scan('learn')]), [true, false, false, false]);
  assert.deepEqual(progress('career', [scan('details-skills')]), [true, true, false, false]);
  assert.deepEqual(progress('career', [scan('learn', 1), scan('attributes-numbers', 0, {})]), [true, true, true, false]);
  assert.deepEqual(progress('finished', [scan('finished-details')]), [true, false, false]);
  assert.deepEqual(progress('finished', [scan('finished-details', 2)]), [true, true, false]);
});

test('Apply labels describe the reviewed build or pending view count', () => {
  assert.equal(guide.importApplyLabel(false, false, 0), 'Apply to build');
  assert.equal(guide.importApplyLabel(false, true, 50), 'Apply 50 skills and stats');
  assert.equal(guide.importApplyLabel(false, true, 1), 'Apply 1 skill and stats');
  assert.equal(guide.importApplyLabel(true, true, 20), 'Apply build');
  assert.equal(guide.importApplyLabel(true, true, 20, 1), 'Finishing 1 view…');
  assert.equal(guide.importApplyLabel(false, true, 20, 3), 'Finishing 3 views…');
});

test('the import submit handler drains the scan before rechecking blockers and keeping focus in review', () => {
  const source = fs.readFileSync(new URL('../apps/desktop/src/StaminaScreenshotImport.tsx', import.meta.url), 'utf8');
  assert.match(source, /active\.started\.then\(\(\) => stopScrolling\(active\.id, true\)\)/);
  assert.match(source, /if \(!applyQueued[^\n]*\(scanGuide \|\| pending \|\| captureBusy\)\)+ return;/);
  assert.match(source, /if \(block\) review\(block\);\s+else applyBuild\(\);/);
  assert.match(source, /control\?\.scrollIntoView\(\{ block: 'nearest' \}\);\s+control\?\.focus/);
  assert.match(source, /<button type="submit" className="import-apply" aria-live="polite">/);
});

const skills = [{ id: 1, name: 'Corner Recovery ○', rarity: 'white', hp_recovery: true },
  { id: 2, name: 'Swinging Maestro', rarity: 'gold', hp_recovery: true },
  { id: 3, name: 'Plancha (inherited)', rarity: 'white', hp_recovery: false }, { id: 4, name: 'Unpriced', rarity: 'white' }];
const hp = (value, conditional = true, other_runner = false) => ({ value, conditional, other_runner });
const points = { 1: { cost: 153, tier: { group: 1, rank: 1 } }, 2: { cost: 180, tier: { group: 1, rank: 2 } },
  3: { cost: 100, tier: null }, 4: { cost: null, tier: null } };
const observations = [1, 2, 3, 4].map(id => ({ id, owned: false, level: null, hint: null, price: null }));
const chains = prices.tierChains(observations, points);
const catalog = { skills, hp_effects: { 1: [hp(150)], 2: [hp(550)], 3: [hp(-400)] } };

test('shop filters and sorts names, prices and HP, and checks the incremental cost against remaining SP', () => {
  const plan = prices.purchasePlan(chains, [1], 340);
  const offers = shop.shopOffers(chains, plan.purchases, catalog);
  const list = (filter = 'All', query = '', sort = 'name', desc = false) =>
    plain(shop.filterShopOffers(offers, filter, query, sort, desc).map(row => row.step.id));
  assert.deepEqual(list(), [1, 3, 2, 4]);
  assert.deepEqual(list('Recoveries', '', 'recovery', true), [2, 1]);
  assert.deepEqual(list('Gold'), [2]);
  assert.deepEqual(list('All', '', 'price'), [3, 1, 2, 4]);
  assert.deepEqual(list('All', 'maestro'), [2]);
  assert.deepEqual(list('All', '', 'recovery'), [3, 1, 2, 4]);
  assert.deepEqual(plain(offers.map(row => row.extraCost)), [null, 180, 100, null]);
  assert.equal(offers.find(row => row.step.id === 3).name, 'Plancha');
  assert.equal(catalog.skills[2].name, 'Plancha (inherited)');
  assert.deepEqual([plan.purchases.length, plan.spent, plan.left], [1, 153, 187]);
});

test('HP labels convert signed hundredths of a percent and explain conditional effects', () => {
  assert.equal(shop.hpPercent(550), '5.5% HP');
  assert.equal(shop.hpPercent(-400), '−4% HP');
  assert.equal(shop.hpEffectTitle(hp(150)), '1.5% HP if it activates');
  assert.equal(shop.hpEffectTitle(hp(-25, false, true)), '−0.25% HP of the affected runner');
});
