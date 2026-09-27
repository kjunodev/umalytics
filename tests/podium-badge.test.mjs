import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModule } from './support/harness.mjs';
import { PREVIEW_PROFILES } from '../apps/extension/dev/preview/fixtures.ts';

function badgesContext() {
  const c = vm.createContext({});
  loadModule(c, 'uiCommonBadges');
  return c;
}

function apiContext() {
  const c = vm.createContext({ console, URL, AbortController, setTimeout, clearTimeout, Date });
  for (const module of ['profileConstants', 'umaReleaseOrder', 'umaPortraits', 'requestQueue']) loadModule(c, module);
  loadModule(c, 'playerProfileApi');
  return c;
}

const baseProfile = (podiums, matches) => ({
  discordId: '1', podiums, matches, statsPrivate: false,
  topUmas: [], bestUmas: [], allUmas: [], recentMatches: [{}]
});

test('podiumRegular badge is absent just below the per-game threshold', () => {
  const c = badgesContext();
  const profile = baseProfile(279, 100);
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'podiumRegular'), false);
});

test('podiumRegular badge appears at exactly the per-game threshold', () => {
  const c = badgesContext();
  const profile = baseProfile(2.8 * 20, 20);
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'podiumRegular'), true);
});

test('podiumRegular badge is absent with 14 games even above the per-game threshold', () => {
  const c = badgesContext();
  const profile = baseProfile(3 * 14, 14);
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'podiumRegular'), false);
});

test('podiumRegular badge appears with 15 games at the per-game threshold', () => {
  const c = badgesContext();
  const profile = baseProfile(2.8 * 15, 15);
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'podiumRegular'), true);
});

test('a player with 351 podiums in 155 games (the original 226% bug case) gets no badge', () => {
  const c = badgesContext();
  const profile = baseProfile(351, 155);
  const badges = c.getNotableBadges(profile);
  assert.equal(badges.some(b => b.kind === 'podiumRegular'), false,
    '351/155 = 2.26 per game, below the 2.8 per-game threshold');
});

test('podiumRegular tooltip uses one decimal per-game phrasing with no percentage', () => {
  const c = badgesContext();
  const profile = baseProfile(445, 155);
  const badges = c.getNotableBadges(profile);
  const podiumBadge = badges.find(b => b.kind === 'podiumRegular');
  assert.ok(podiumBadge);
  assert.equal(podiumBadge.title, 'Averages 2.9 podium finishes per game (445 in 155 games), with 15+ games in the selected stat scope.');
});

test('Uma Score stays capped at 100 even when input rates exceed their bounds', () => {
  const c = apiContext();
  assert.equal(c.calculatePerformanceScore(20, 2, 3), 100);
  assert.equal(c.calculatePerformanceScore(3, 0.75, 20 / 12), c.calculatePerformanceScore(3, 0.75, 1));
});

test('preview fixture Uma Scores use the same 0–100 scale', () => {
  const umas = Object.values(PREVIEW_PROFILES).flatMap(profile => profile.allUmas ?? profile.topUmas ?? []);
  assert.ok(umas.length > 0);
  assert.ok(umas.every(uma => uma.performanceScore >= 0 && uma.performanceScore <= 100));
});
