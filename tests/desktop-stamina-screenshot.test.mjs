import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dedupeRows, discountedPrice, purchasePlan, restoreScreenshotImport, selectTier, tierChains,
} from '../apps/desktop/src/staminaScreenshot.ts';

const catalog = {
  110311: { cost: null, tier: null },
  200011: { cost: 110, tier: { group: 20001, rank: 2 } },
  200012: { cost: 90, tier: { group: 20001, rank: 1 } },
  200013: { cost: 50, tier: null },
  200014: { cost: 130, tier: { group: 20001, rank: 3 } },
  200501: { cost: 120, tier: { group: 20050, rank: 2 } },
  200502: { cost: 120, tier: { group: 20050, rank: 1 } },
  910311: { cost: 200, tier: null },
};
const offer = (id, price, hint = null) => ({ id, price, hint, owned: false, level: null });
const owned = (id, level = null) => ({ ...offer(id, null), owned: true, level });
const white = offer(200502, 120);
const gold = offer(200501, 228, 1);

test('applies each hint discount to the base cost', () => {
  assert.deepEqual([null, 1, 2, 3, 4, 5].map(hint => discountedPrice(200, hint)), [200, 180, 160, 140, 130, 120]);
  assert.equal(discountedPrice(90, 3), 63);
  assert.equal(discountedPrice(110, 4), 71);
});

test('deduplicates overlapping Learn and owned rows without hiding conflicting scanned prices', () => {
  const rows = [white, { ...white }, offer(200502, 130), owned(200502), owned(110311, 4), owned(110311, 5)];
  for (const input of [rows, [...rows].reverse()]) {
    const result = dedupeRows(input);
    assert.equal(result.get(200502).owned, true);
    assert.equal(result.get(110311).level, 5);
    assert.equal(result.get(200502).offers.length, 2);
    const chain = tierChains(input, catalog).find(chain => chain.owned.id === 200502);
    assert.deepEqual(chain.steps[0], { id: 200502, selectable: false, total: 120, scanned: [120, 130], priceIssue: 'Price mismatch' });
  }
});

test('steps from none to white to gold, budgets both discounts and submits one tier', () => {
  const chains = tierChains([gold, { ...white, hint: 2, price: 96 }, owned(110311, 5)], catalog);
  const chain = chains.find(chain => chain.key === 'group-20050');
  assert.deepEqual(chain.steps.map(step => [step.id, step.total, step.priceIssue]), [[200502, 96, null], [200501, 204, 'Price mismatch']]);
  let selected = selectTier([], chain, 200502);
  assert.deepEqual(purchasePlan(chains, selected, 200), {
    left: 104, overBudget: false, skills: [{ id: 110311, level: 5 }, { id: 200502, level: 1 }],
  });
  selected = selectTier(selected, chain, 200501);
  assert.deepEqual(purchasePlan(chains, selected, 200), {
    left: -4, overBudget: true, skills: [{ id: 110311, level: 5 }, { id: 200501, level: 1 }],
  });
  assert.deepEqual(purchasePlan(chains, selectTier(selected, chain), 200).skills, [{ id: 110311, level: 5 }]);
});

test('charges only the upgrade when the prerequisite is owned', () => {
  const chains = tierChains([owned(200502), offer(200501, 108, 1)], catalog);
  assert.deepEqual(chains[0].steps.map(step => [step.id, step.total, step.priceIssue]), [[200501, 108, null]]);
  assert.deepEqual(purchasePlan(chains, [], 108).skills, [{ id: 200502, level: 1 }]);
  assert.deepEqual(purchasePlan(chains, [200501], 108), { left: 0, overBudget: false, skills: [{ id: 200501, level: 1 }] });
});

test('prices ◎ over ○ and keeps a negative version independent', () => {
  const chains = tierChains([offer(200011, 151, 2), offer(200012, 63, 3), owned(200013)], catalog);
  assert.deepEqual(chains[0].steps.map(step => [step.id, step.total, step.priceIssue]), [[200012, 63, null], [200011, 151, null]]);
  assert.deepEqual(purchasePlan(chains, [200011], 250), {
    left: 99, overBudget: false, skills: [{ id: 200011, level: 1 }, { id: 200013, level: 1 }],
  });
});

test('charges the base white once when a group offers both ◎ and gold', () => {
  const [chain] = tierChains([offer(200014, 193), offer(200011, 151, 2), offer(200012, 63, 3)], catalog);
  assert.deepEqual(chain.steps.map(step => [step.id, step.total, step.priceIssue]), [
    [200012, 63, null], [200011, 151, null], [200014, 193, null],
  ]);
});

test('flags a prerequisite missing from the screenshots and keeps the estimated tier selectable', () => {
  const [chain] = tierChains([gold], catalog);
  assert.deepEqual(chain.steps.map(step => [step.id, step.total, step.priceIssue]), [
    [200502, 120, 'Price unverified'], [200501, 228, 'Price unverified'],
  ]);
});

test('uses a readable overlapping hint and flags prices that could not be checked', () => {
  const unknown = { ...offer(910311, 180), hintUnreadable: true };
  const rows = [white, unknown];
  const noHint = tierChains(rows, catalog);
  assert.equal(noHint[1].steps[0].total, null);
  assert.equal(purchasePlan(noHint, [200502, 910311], 100).left, null);
  assert.equal(purchasePlan(noHint, [200502, 910311], 100).overBudget, true);
  const withHint = tierChains([...rows, offer(910311, 180, 1)], catalog);
  assert.equal(withHint[1].steps[0].total, 180);
  assert.equal(withHint[1].steps[0].priceIssue, 'Price unverified');
});

test('restores scan points, rows and selections and drops missing catalog entries', () => {
  const scan = { points: 240, observations: [white, gold, owned(999)], selected: [200501, 999], ignored: ['Carnival Bonus', null] };
  const restored = restoreScreenshotImport(JSON.parse(JSON.stringify(scan)), catalog);
  assert.deepEqual(restored, { points: 240, observations: [white, gold], selected: [200501], ignored: ['Carnival Bonus'] });
  assert.equal(purchasePlan(tierChains(restored.observations, catalog), restored.selected, restored.points).left, 12);
});
