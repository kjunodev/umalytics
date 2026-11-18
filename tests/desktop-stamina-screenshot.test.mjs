import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availablePurchaseTiers, dedupeRows, discountedPrice, hintDiscount, importedBuildSkills, priceAfterTier, purchaseList, purchasePlan,
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
  200033: tier(50, 20003, -1),
  200032: tier(90, 20003, 1),
  200031: tier(110, 20003, 2, 200032),
};
const offer = (id, price, hint) => ({ id, price, hint, owned: false, level: null, learn: true });
const owned = (id, level = null, hint = null) => ({ ...offer(id, null, hint), owned: true, level, learn: hint !== null });
const fastPaced = offer(200542, 126, 3);
const escapeArtist = offer(200541, 252, 3);
const mediumCorners = offer(201112, 70, 3);
const refractionArc = offer(201113, 282, 1);
const costs = chain => chain.steps.filter(step => step.selectable).map(step => [step.id, step.total, step.priceIssue]);
const planState = ({ left, overBy, skills }) => ({ left, overBy, skills });

test('Tokyo Racecourse × is owned until its removal is selected, including older Learn imports', () => {
  const removal = offer(200033, 50, null);
  const [chain] = tierChains([owned(200033), removal], catalog);
  assert.deepEqual(planState(purchasePlan([chain], [], 200)), { left: 200, overBy: 0, skills: [{ id: 200033, level: 1 }] });
  assert.deepEqual(planState(purchasePlan([chain], [200033], 200)), { left: 150, overBy: 0, skills: [] });
  assert.deepEqual(purchasePlan(tierChains([removal], catalog), [], 200).skills, [{ id: 200033, level: 1 }]);
  assert.deepEqual(chain.steps.filter(step => step.selectable).map(step => [step.id, step.total, !!step.estimated]),
    [[200033, 50, false], [200032, 140, true], [200031, 250, true]]);
  assert.deepEqual(costs(tierChains([owned(200033)], catalog)[0]), []);
});

test('Tokyo Racecourse ○ replaces the debuff and accounts for the removal once', () => {
  const [chain] = tierChains([owned(200033), offer(200033, 50, null), offer(200032, 140, null)], catalog);
  const circle = chain.steps.find(step => step.id === 200032);
  assert.equal(circle.total, 140);
  assert.equal(circle.estimated, true);
  assert.equal(priceAfterTier(chain, circle, 200033), 90);
  assert.deepEqual(planState(purchasePlan([chain], selectTier([200033], chain, 200032), 200)),
    { left: 60, overBy: 0, skills: [{ id: 200032, level: 1 }] });
  assert.deepEqual(purchasePlan(tierChains([owned(200032), offer(200033, 50, null)], catalog), [], 200).skills,
    [{ id: 200032, level: 1 }]);
});

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
  assert.deepEqual(planState(purchasePlan(chains, selected, 200)), {
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

test('Taking the Lead infers the missing Early Lead discount', () => {
  const takingTheLead = offer(200531, 180, 1);
  assert.deepEqual(costs(tierChains([takingTheLead], catalog)[0]),
    [[200532, 72, null], [200531, 180, null]]);
  assert.deepEqual(costs(tierChains([takingTheLead, offer(200532, 72, 5)], catalog)[0]),
    [[200532, 72, null], [200531, 180, null]]);
});

test('Escape Artist at 234 SP and hint 3 implies Fast-Paced at 108 SP and Max', () => {
  const gold = offer(200541, 234, 3);
  const [chain] = tierChains([gold], catalog);
  assert.deepEqual(costs(chain), [[200542, 108, null], [200541, 234, null]]);
  assert.equal(chain.steps[0].hint, 5);
  assert.equal(chain.steps[0].inferredFrom, 200541);
  assert.equal(priceAfterTier(chain, chain.steps[1], 200542), 126);
  assert.equal(purchasePlan([chain], [200541], 234).left, 0);
  assert.equal(tierChains([gold, offer(200542, 108, 5)], catalog)[0].steps[0].inferredFrom, undefined);
});

test('keeps price flags when the remainder is invalid, conflicting, or two prerequisites are missing', () => {
  for (const offers of [[offer(200541, 235, 3)], [offer(200541, 234, 3), offer(200541, 252, 3)]]) {
    assert.deepEqual(costs(tierChains(offers, catalog)[0]),
      [[200542, 180, 'Price unverified'], [200541, 306, 'Price mismatch']]);
  }
  const [chain] = tierChains([refractionArc], catalog);
  assert.equal(chain.steps[0].inferredFrom, undefined);
  assert.equal(chain.steps[1].inferredFrom, undefined);
  assert.equal(chain.steps[2].priceIssue, 'Price mismatch');
});

test('a scanned double-circle price can establish the missing single-circle discount', () => {
  const [chain] = tierChains([offer(200181, 131, 3)], catalog);
  assert.deepEqual(costs(chain), [[200182, 54, null], [200181, 131, null]]);
  assert.equal(chain.steps[0].hint, 5);
  assert.equal(chain.steps[0].inferredFrom, 200181);
});

test('Focus at 84 SP recovers Hint Max from a misread or unreadable hint', () => {
  const focus = { 1: { cost: 140, tier: null } };
  for (const read of [offer(1, 84, 4), { ...offer(1, 84, null), hintUnreadable: true }]) {
    const [chain] = tierChains([read], focus);
    assert.deepEqual(costs(chain), [[1, 84, null]]);
    assert.equal(chain.steps[0].hint, 5);
    assert.equal(purchasePlan([chain], [1], 100).left, 16);
  }
  assert.deepEqual(costs(tierChains([offer(1, 74, 4)], focus)[0]), [[1, 91, 'Price mismatch']]);
  assert.equal(tierChains([offer(1, 84, 4), offer(1, 91, 4)], focus)[0].steps[0].priceIssue, 'Price mismatch');
  assert.equal(tierChains([offer(1, 84, 4), offer(1, 84, 5)], focus)[0].steps[0].priceIssue, 'Price mismatch');
});

test('reconciled lower and gold prices preserve the full price and incremental upgrade', () => {
  const [chain] = tierChains([offer(200541, 225, 4), offer(200542, 117, 3)], catalog);
  assert.deepEqual(costs(chain), [[200542, 117, null], [200541, 225, null]]);
  assert.deepEqual(chain.steps.map(step => step.hint), [4, 5]);
  assert.equal(priceAfterTier(chain, chain.steps[1], 200542), 108);
});

test('removal scans reconcile hints and carry the verified removal cost into upgrades', () => {
  const [chain] = tierChains([owned(200033), offer(200033, 30, 4), offer(200032, 120, null)], catalog);
  const [removal, circle] = chain.steps.filter(step => step.selectable);
  assert.deepEqual([removal.hint, removal.total, removal.priceIssue, circle.total], [5, 30, null, 120]);
  assert.equal(priceAfterTier(chain, circle, 200033), 90);
  assert.equal(tierChains([offer(200033, 29, 4)], catalog)[0].steps.find(step => step.removal).priceIssue, 'Price mismatch');
});

test('restores scans and keeps a finished Uma build without a budget or purchasable skills', () => {
  const scan = { points: 252, observations: [fastPaced, escapeArtist, owned(999)], selected: [200541, 999], ignored: ['Carnival Bonus'] };
  const restored = restoreScreenshotImport(JSON.parse(JSON.stringify(scan)), catalog);
  assert.deepEqual(restored, { points: 252, observations: [fastPaced, escapeArtist], selected: [200541], ignored: ['Carnival Bonus'] });
  const finished = restoreScreenshotImport({ ...scan, points: null, observations: [owned(110681, 5), owned(200182), fastPaced] }, catalog);
  assert.deepEqual(planState(purchasePlan(tierChains(finished.observations, catalog), finished.selected, finished.points)), {
    left: null, overBy: 0, skills: [{ id: 110681, level: 5 }, { id: 200182, level: 1 }],
  });
});

test('Buying uses the total across selected tiers and copies plain names and prices', () => {
  const chains = tierChains([fastPaced, escapeArtist, owned(200033), offer(200033, 50, null)], catalog);
  const plan = purchasePlan(chains, [200541, 200033], 250);
  assert.equal(plan.spent, 302);
  assert.equal(plan.left, -52);
  assert.equal(plan.purchases.length, 2);
  const names = { 200541: 'Escape Artist', 200033: 'Tokyo Racecourse ×' };
  assert.equal(purchaseList(plan.purchases, id => names[id]), 'Escape Artist — 252 SP\nRemove Tokyo Racecourse × — 50 SP');
});

test('a bought tier is omitted from Available while other tiers remain selectable', () => {
  const [chain] = tierChains([fastPaced, escapeArtist], catalog);
  const [purchase] = purchasePlan([chain], [200541, 200542], 252).purchases;
  assert.equal(purchase.id, 200541);
  assert.deepEqual(availablePurchaseTiers(chain, purchase).map(step => step.id), [200542]);
  assert.deepEqual(availablePurchaseTiers(chain).map(step => step.id), [200542, 200541]);
  const [debuff] = tierChains([owned(200033), offer(200033, 50, null)], catalog);
  const [removal] = purchasePlan([debuff], [200033], 250).purchases;
  assert.equal(removal.removal, true);
  assert(!availablePurchaseTiers(debuff, removal).some(step => step.id === removal.id));
});

test('manual skills augment a scan without replacing purchases or duplicating scanned tiers', () => {
  const chains = tierChains([fastPaced, escapeArtist], catalog);
  assert.deepEqual(importedBuildSkills({ selected: [200541], points: 252, manualSkills: [9, 9, 200542] }, chains, catalog),
    [{ id: 9, level: 1 }, { id: 200541, level: 1 }]);
});
