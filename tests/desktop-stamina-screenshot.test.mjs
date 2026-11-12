import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dedupeRows, discountedPrice, hintDiscount, priceAfterTier, purchasePlan,
  restoreScreenshotImport, selectTier, tierChains,
} from '../apps/desktop/src/staminaScreenshot.ts';

const tier = (cost, group, rank, hint_from) => ({ cost, tier: { group, rank }, hint_from });
const catalog = {
  110681: { cost: null, tier: null },
  200181: tier(110, 20018, 2, 200182),
  200182: tier(90, 20018, 1),
  200531: tier(120, 20053, 2),
  200532: tier(120, 20053, 1),
  200541: tier(180, 20054, 2),
  200542: tier(180, 20054, 1),
  201111: tier(110, 20111, 2, 201112),
  201112: tier(100, 20111, 1),
  201113: tier(150, 20111, 3),
  201282: tier(180, 20128, 1),
};
const offer = (id, price, hint) => ({ id, price, hint, owned: false, level: null, learn: true });
const owned = (id, level = null, hint = null) => ({ ...offer(id, null, hint), owned: true, level, learn: hint !== null });
const fastPaced = offer(200542, 126, 3);
const escapeArtist = offer(200541, 252, 3);
const mediumCorners = offer(201112, 70, 3);
const refractionArc = offer(201113, 282, 1);
const costs = chain => chain.steps.filter(step => step.selectable).map(step => [step.id, step.total, step.priceIssue]);

test('uses all five hint discounts, including Max, and floors each tier', () => {
  assert.deepEqual([null, 1, 2, 3, 4, 5].map(hintDiscount), [0, 10, 20, 30, 35, 40]);
  assert.equal(discountedPrice(180, 5), 108); // Moxie
  assert.equal(discountedPrice(90, 4), 58); // Competitive Spirit ○
});

test('Escape Artist shows 252, then 126 after selecting Fast-Paced', () => {
  const chains = tierChains([escapeArtist, fastPaced], catalog);
  const [chain] = chains;
  assert.deepEqual(costs(chain), [[200542, 126, null], [200541, 252, null]]);
  let selected = selectTier([], chain, 200542);
  assert.equal(priceAfterTier(chain, chain.steps[1], selected[0]), 126);
  selected = selectTier(selected, chain, 200541);
  assert.deepEqual(purchasePlan(chains, selected, 200), {
    left: -52, overBy: 52, skills: [{ id: 200541, level: 1 }],
  });
  assert.equal(purchasePlan(chains, selectTier(selected, chain), 200).left, 200);
});

test('obtained Fast-Paced keeps its hint and Escape Artist shows 126', () => {
  const chains = tierChains([offer(200541, 126, 3), owned(200542, null, 3)], catalog);
  assert.deepEqual(costs(chains[0]), [[200541, 126, null]]);
  assert.equal(chains[0].steps[0].owned, true);
  assert.equal(chains[0].steps[0].hint, 3);
  assert.deepEqual(purchasePlan(chains, [], 126).skills, [{ id: 200542, level: 1 }]);
  assert.equal(purchasePlan(chains, [200541], 126).left, 0);
});

test('Refraction Arc shows 282, 212 after Medium Corners ○ and 135 after ◎', () => {
  const chains = tierChains([refractionArc, mediumCorners], catalog);
  const [chain] = chains;
  assert.deepEqual(costs(chain), [[201112, 70, null], [201111, 147, null], [201113, 282, null]]);
  assert.equal(priceAfterTier(chain, chain.steps[1], 201112), 77);
  assert.equal(priceAfterTier(chain, chain.steps[2], 201112), 212);
  assert.equal(priceAfterTier(chain, chain.steps[2], 201111), 135);
  assert.deepEqual(costs(tierChains([offer(201113, 212, 1), offer(201111, 77, 3), owned(201112)], catalog)[0]),
    [[201111, 77, null], [201113, 212, null]]);
  assert.deepEqual(costs(tierChains([offer(201113, 135, 1), owned(201111, null, 3)], catalog)[0]), [[201113, 135, null]]);
  assert.equal(purchasePlan(chains, [201113], 282).left, 0);
});

test('Summer Runner ○ costs 72 and ◎ costs 88 after ○ using the same hint', () => {
  const [chain] = tierChains([offer(200182, 72, 2)], catalog);
  assert.deepEqual(costs(chain), [[200182, 72, null], [200181, 160, null]]);
  assert.equal(priceAfterTier(chain, chain.steps[1], 200182), 88);
  assert.equal(chain.steps[1].hint, 2);
});

test('deduplicates overlapping Learn and owned rows while retaining scanned prices and hints', () => {
  const rows = [fastPaced, { ...fastPaced }, owned(200542, null, 3), owned(110681), owned(110681, 5)];
  for (const input of [rows, [...rows].reverse()]) {
    const result = dedupeRows(input);
    assert.equal(result.get(200542).owned, true);
    assert.equal(result.get(200542).learn.length, 2);
    assert.equal(result.get(110681).level, 5);
  }
});

test('Taking the Lead flags 180 versus 228 until the missing Early Lead hint is captured', () => {
  const takingTheLead = offer(200531, 180, 1);
  assert.deepEqual(costs(tierChains([takingTheLead], catalog)[0]),
    [[200532, 120, 'Price unverified'], [200531, 228, 'Price mismatch']]);
  assert.deepEqual(costs(tierChains([takingTheLead, offer(200532, 72, 5)], catalog)[0]),
    [[200532, 72, null], [200531, 180, null]]);
});

test('recovers a Max hint from an overlapping screenshot and flags an unreadable price', () => {
  const unknown = { ...offer(201282, 108, null), hintUnreadable: true };
  const noHint = tierChains([unknown], catalog);
  assert.equal(purchasePlan(noHint, [201282], 200).left, null);
  const withHint = tierChains([unknown, offer(201282, 108, 5)], catalog);
  assert.equal(withHint[0].steps[0].total, 108);
  assert.equal(withHint[0].steps[0].priceIssue, 'Price unverified');
});

test('restores scans and keeps a finished Uma build without a budget or purchasable skills', () => {
  const scan = { points: 252, observations: [fastPaced, escapeArtist, owned(999)], selected: [200541, 999], ignored: ['Carnival Bonus'] };
  const restored = restoreScreenshotImport(JSON.parse(JSON.stringify(scan)), catalog);
  assert.deepEqual(restored, { points: 252, observations: [fastPaced, escapeArtist], selected: [200541], ignored: ['Carnival Bonus'] });
  const finished = restoreScreenshotImport({ ...scan, points: null, observations: [owned(110681, 5), owned(200182), fastPaced] }, catalog);
  assert.deepEqual(purchasePlan(tierChains(finished.observations, catalog), finished.selected, finished.points), {
    left: null, overBy: 0, skills: [{ id: 110681, level: 5 }, { id: 200182, level: 1 }],
  });
});
