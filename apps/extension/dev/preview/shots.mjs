// pnpm preview:shots — starts the preview harness (dev/preview) and saves a
// screenshot of every scene/state at all supported viewport sizes and UI sizes into
// dev/preview/.shots (git-ignored). Dev-only: never run as part of a build.
//
// --concurrency=N   worker pool size (default: CPU count - 1)
// --scenes=a,b,...  only run these scenes (see SCENES below for names)
// --sizes=WxH,...   only run these viewport sizes (see SIZES below for names)
// --interactions-only  skip the screenshot matrix, only run verifyInteractions
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { checkGeometry, checkTeamIconTooltip } from './geometry.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dirname, '.shots');

const SIZES = [
  [1024, 768], [1100, 900], [1265, 1100], [1280, 720],
  [1366, 768], [1625, 1360], [1920, 1080], [2560, 1300]
].map(([width, height]) => ({ name: `${width}x${height}`, width, height }));
const UI_SIZES = ['small', 'default', 'large'];

// Query string per scene/state — see PreviewApp.tsx's initialStateFromQuery.
const SCENES = [
  { name: 'lobby', query: 'mode=live&scene=lobby' },
  { name: 'drawer', query: 'mode=live&scene=lobby&player=100000000000000000:user-0' },
  { name: 'draft-mid', query: 'mode=live&scene=draft&draft=mid' },
  { name: 'draft-complete', query: 'mode=live&scene=draft&draft=complete' },
  { name: 'umas', query: 'mode=live&scene=umas' },
  { name: 'players', query: 'mode=profiles' },
  { name: 'history-lobby', query: 'mode=history&scene=lobby' },
  { name: 'history-draft', query: 'mode=history&scene=draft&draft=complete' }
];

function argValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function filterByName(all, requestedCsv, label) {
  if (!requestedCsv) return all;
  const requested = requestedCsv.split(',').map(s => s.trim()).filter(Boolean);
  const byName = new Map(all.map(item => [item.name, item]));
  const unknown = requested.filter(name => !byName.has(name));
  if (unknown.length) {
    throw new Error(`Unknown ${label}: ${unknown.join(', ')} (available: ${all.map(item => item.name).join(', ')})`);
  }
  return requested.map(name => byName.get(name));
}

const scenes = filterByName(SCENES, argValue('scenes'), 'scene');
const sizes = filterByName(SIZES, argValue('sizes'), 'size');
const concurrency = Math.max(1, Number(argValue('concurrency')) || Math.max(1, os.cpus().length - 1));

let activeBrowser;
let activeServer;

async function shutdown(code) {
  await Promise.allSettled([activeBrowser?.close(), activeServer?.close()]);
  process.exit(code);
}
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

async function newPage(browser) {
  const page = await browser.newPage();
  await page.route('https://**/*', route => route.abort());
  return page;
}

async function runCase(page, baseUrl, { uiSize, scene, size }) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`${baseUrl}/?${scene.query}&uiSize=${uiSize}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-header').waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (scene.name.includes('draft')) {
    for (const panel of await page.locator('.draft-team-panel').all()) {
      const picks = panel.locator('.draft-pick-tile button');
      if (await picks.count()) await picks.nth((await picks.count()) > 1 ? 1 : 0).click();
    }
  }
  await page.waitForTimeout(50);
  const geometry = await page.evaluate(checkGeometry);
  if (scene.name === 'lobby' || scene.name === 'history-lobby') {
    const heights = await page.locator('.player-row:not(.empty-player-row)').evaluateAll(
      elements => elements.map(el => el.getBoundingClientRect().height)
    );
    // Same 1.1px tolerance as checkGeometry's own dimension checks
    // (fractional `zoom` rounds each box's subpixels independently).
    if (Math.max(...heights) - Math.min(...heights) > 1.1) {
      geometry.failures.push(`lobby cards do not share one height at ${size.name} ${uiSize}: ${heights.join(', ')}`);
    }
  }
  if (scene.name === 'lobby' || scene.name === 'history-lobby') {
    const crowns = await page.locator('.player-row .captain-crown').count();
    if (crowns !== 2) geometry.failures.push(`expected 2 captain crowns in ${scene.name} at ${size.name} ${uiSize}, found ${crowns}`);
  }
  const fileName = `${scene.name}_${size.name}_${uiSize}.png`;
  await page.screenshot({ path: path.join(outDir, fileName) });
  return { scene: scene.name, size: size.name, uiSize, fileName, ...geometry };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const server = await createServer({ configFile: path.join(dirname, 'vite.config.ts'), root: dirname });
  activeServer = server;
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address !== null ? address.port : undefined;
  if (port === undefined) throw new Error('Preview dev server did not report a port.');
  const baseUrl = `http://localhost:${port}`;

  const browser = await chromium.launch({ channel: process.env.PREVIEW_BROWSER ?? 'chrome' });
  activeBrowser = browser;
  try {
    if (process.argv.includes('--interactions-only')) {
      const page = await newPage(browser);
      await verifyInteractions(page, baseUrl);
      await verifyTeamIconTooltips(page, baseUrl);
      return;
    }

    const cases = [];
    for (const uiSize of UI_SIZES) for (const scene of scenes) for (const size of sizes) cases.push({ uiSize, scene, size });

    const total = cases.length;
    const workerCount = Math.min(concurrency, total);
    console.log(`Running ${total} cases across ${workerCount} worker${workerCount === 1 ? '' : 's'}...`);

    const results = [];
    let completed = 0;
    async function worker() {
      const page = await newPage(browser);
      try {
        while (cases.length) {
          const nextCase = cases.shift();
          if (!nextCase) break;
          const result = await runCase(page, baseUrl, nextCase);
          results.push(result);
          completed++;
          console.log(`[${completed}/${total}] ${result.failures.length ? 'FAIL' : 'PASS'} ${result.fileName}: ${result.failures.length} geometry failures`);
          if (result.failures.length) console.log(result.failures.join('\n'));
        }
      } finally {
        await page.close();
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    fs.writeFileSync(path.join(outDir, 'geometry.json'), JSON.stringify(results, null, 2));
    const failures = results.filter(result => result.failures.length);
    console.log(`${results.length} cases, ${failures.length} failed cases`);
    if (failures.length) process.exitCode = 1;

    const interactionsPage = await newPage(browser);
    await verifyInteractions(interactionsPage, baseUrl);
    await verifyTeamIconTooltips(interactionsPage, baseUrl);
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`\nDone. Screenshots in ${path.relative(process.cwd(), outDir)}`);
}

async function verifyInteractions(page, baseUrl) {
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await page.locator('html[data-ui-size="small"] .app-header').waitFor();
  await page.setViewportSize({ width: 1280, height: 1300 });
  await page.reload();
  await page.locator('html[data-ui-size="small"] .app-header').waitFor();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Large', exact: true }).click();
  await page.locator('html[data-ui-size="large"]').waitFor();
  await page.reload();
  await page.locator('html[data-ui-size="large"] .app-header').waitFor();

  await page.goto(`${baseUrl}/?mode=live&scene=lobby&uiSize=default`);
  await page.locator('.player-row').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const heights = () => page.locator('.player-row').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
  const tall = await heights();
  // Fixture order (fixtures.ts PREVIEW_PROFILES): 0/5 rich+party-duo or
  // captain, 1 fewer-than-3-Umas (also party-duo), 2 loading, 3/6 private,
  // 4 error, 7/8 plain loaded, 9 loaded with zero Umas ("no ranked Uma data
  // found"). Every card must be the same height regardless of state — the
  // Duo chip and team icon are centered inside .card-name-row's fixed
  // height rather than growing it, so cards 0/1 match the rest too. Same
  // 1.1px tolerance as checkGeometry's own dimension checks (fractional
  // `zoom` rounds each box's subpixels independently).
  assert.ok(Math.max(...tall) - Math.min(...tall) <= 1.1,
    `all lobby cards must share one height, got: ${tall.join(', ')}`);
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.deepEqual(await heights(), tall, 'card height must not change with window height');

  await page.goto(`${baseUrl}/?mode=live&scene=lobby&uiSize=default&player=100000000000000000:user-0`);
  await page.locator('.drawer-history-row').first().waitFor();
  const pointLabels = await page.locator('.drawer-history-points').evaluateAll(elements => elements.map(el =>
    [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()));
  assert.equal(pointLabels.filter(label => label === '1 pt').length, 1);
  await page.getByRole('button', { name: 'Next Umas', exact: true }).click();
  assert.equal(await page.locator('.uma-table-row').count(), 1);
  await page.getByRole('button', { name: 'Previous Umas', exact: true }).click();
  const oldRows = await page.locator('.recent-match-code').allTextContents();
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  assert.equal(await page.locator('.drawer-history-row').count(), 5);
  assert.notDeepEqual(await page.locator('.recent-match-code').allTextContents(), oldRows);
  const brokenStyle = await page.addStyleTag({ content: '.uma-table-row { min-height: 24px; height: 24px; }' });
  assert((await page.evaluate(checkGeometry)).failures.some(failure => failure.includes('uma-table-row contains overflow')),
    'geometry checker must catch the original portrait/row overlap');
  await brokenStyle.evaluate(el => el.remove());
  assert.deepEqual((await page.evaluate(checkGeometry)).failures, []);

  await page.goto(`${baseUrl}/?mode=live&scene=lobby&uiSize=default&player=100000000000000006:user-6`);
  await page.locator('.drawer-history-row').first().waitFor();
  console.log('PASS UI size initialization, resize stability, menu persistence, paging, point pluralization, and geometry negative control');

  // A match code in the drawer opens History with that code (and closes the
  // drawer); the small icon next to it still opens the Uma Drafter page.
  await page.goto(`${baseUrl}/?mode=live&scene=lobby&uiSize=default&player=100000000000000000:user-0`);
  await page.locator('.drawer-history-row').first().waitFor();
  const firstCode = (await page.locator('.recent-match-code').first().textContent()).trim();
  const external = page.locator('.recent-match-external').first();
  assert.equal(await external.getAttribute('title'), 'Open on Uma Drafter');
  assert.equal(await external.getAttribute('target'), '_blank');
  assert.equal(await external.getAttribute('href'), `https://drafter.uma.guide/matches/${firstCode}`);
  const before = await page.locator('.recent-match-cell').first().boundingBox();
  await page.locator('.recent-match-code').first().hover();
  assert.deepEqual(await page.locator('.recent-match-cell').first().boundingBox(), before, 'hovering a match code must not shift layout');
  await page.locator('.recent-match-code').first().click();
  await page.locator('.player-drawer').waitFor({ state: 'detached' });
  assert.match(await page.locator('nav[aria-label="UmaLytics mode"] button[aria-pressed="true"]').textContent(), /History/,
    'clicking a match code must switch to History mode');
  assert.match(await page.locator('.app-header').innerText(), new RegExp(firstCode));
  console.log('PASS match code opens History and closes the drawer; external icon links to Uma Drafter');

  // Players: the season header shows the season's display name, and the rating
  // column shows rating - RD and sorts by it.
  await page.goto(`${baseUrl}/?mode=profiles&uiSize=default`);
  await page.locator('.players-row').first().waitFor();
  assert.equal((await page.locator('.players-season').textContent()).trim(), 'Season 4 (Preview Series)');
  assert.equal((await page.locator('.players-row').first().locator('.players-num').first().textContent()).trim(), '2,055');
  console.log('PASS Players season name and rating - RD');

  // Draft balance negative controls: the geometry check must catch uneven
  // column bottoms and wrapped chips, and a too-narrow race card must collapse
  // only the weather chip to an icon (its label stays as the tooltip).
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto(`${baseUrl}/?mode=live&scene=draft&draft=complete&uiSize=default`);
  await page.locator('.draft-race-card .draft-mod').first().waitFor();
  assert.deepEqual((await page.evaluate(checkGeometry)).failures, []);
  const unbalanced = await page.addStyleTag({ content: '.draft-columns { align-items: start; }' });
  assert((await page.evaluate(checkGeometry)).failures.some(failure => failure.includes('end at different heights')),
    'geometry checker must catch uneven draft column bottoms');
  await unbalanced.evaluate(el => el.remove());
  const wrapped = await page.addStyleTag({ content: '.draft-race-mods { flex-wrap: wrap; width: 120px; }' });
  assert((await page.evaluate(checkGeometry)).failures.some(failure => failure.includes('chips wrap')),
    'geometry checker must catch wrapped race chips');
  await wrapped.evaluate(el => el.remove());
  const narrow = await page.addStyleTag({ content: '.draft-race-mods { width: 200px; }' });
  const label = page.locator('.draft-mod[data-tone^="weather-"] .draft-mod-label').first();
  assert.equal(await label.evaluate(el => el.getBoundingClientRect().width <= 1), true, 'narrow race cards show the weather chip as an icon only');
  assert.match(await page.locator('.draft-mod[data-tone^="weather-"]').first().getAttribute('title'), /\S/, 'icon-only weather chip keeps its label as a tooltip');
  assert.equal(await page.locator('.draft-mod[data-tone^="surface-"] .draft-mod-label').first().evaluate(el => el.getBoundingClientRect().width > 10), true,
    'surface chip keeps its text');
  await narrow.evaluate(el => el.remove());
  console.log('PASS draft column alignment, single-line race chips, and icon-only weather fallback');
}

const pageScrollSize = page => page.evaluate(() => ({
  width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight
}));

// Every place a team icon appears: hover (and once keyboard focus) must show a
// compact tooltip next to the icon that stays inside its card, row or drawer,
// covers no neighbouring card or row, and never causes page scroll.
async function verifyTeamIconTooltips(page, baseUrl) {
  const contexts = [
    { name: 'lobby card', query: 'mode=live&scene=lobby', icon: '.player-row .team-icon', boundsSelector: '.player-row', siblingSelector: '.player-row' },
    { name: 'history card', query: 'mode=history&scene=lobby', icon: '.player-row .team-icon', boundsSelector: '.player-row', siblingSelector: '.player-row' },
    { name: 'players row', query: 'mode=profiles', icon: '.players-row .team-icon', boundsSelector: '.players-row', siblingSelector: '.players-row', compact: true },
    { name: 'drawer header', query: 'mode=live&scene=lobby&player=100000000000000000:user-0', icon: '.player-drawer .team-icon', boundsSelector: '.player-drawer', siblingSelector: '.no-neighbours' }
  ];
  const sizes = SIZES.filter(size => ['1024x768', '1280x720', '1625x1360', '2560x1300'].includes(size.name));
  let checked = 0;
  for (const uiSize of UI_SIZES) for (const size of sizes) for (const context of contexts) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`${baseUrl}/?${context.query}&uiSize=${uiSize}`, { waitUntil: 'domcontentloaded' });
    await page.locator(context.icon).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const baseline = await pageScrollSize(page);
    await page.locator(context.icon).first().hover();
    await page.waitForTimeout(200);
    const result = await page.evaluate(checkTeamIconTooltip, { ...context, baseline });
    const where = `${context.name} at ${size.name} ${uiSize}`;
    assert.deepEqual(result.failures, [], `team icon tooltip, ${where}: ${result.failures.join('; ')}`);
    if (context.compact) assert.ok(result.width < result.containerWidth / 2, `team icon tooltip spans the whole row, ${where}`);
    await page.mouse.move(0, 0);
    checked++;
  }
  // Keyboard focus shows it too (Tab from the page start to the first icon).
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${baseUrl}/?mode=live&scene=lobby&uiSize=default`);
  await page.locator('.player-row .team-icon').first().waitFor();
  const focusBaseline = await pageScrollSize(page);
  for (let i = 0; i < 60 && !(await page.evaluate(() => document.activeElement?.classList.contains('team-icon'))); i++) await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  const focused = await page.evaluate(checkTeamIconTooltip, { ...contexts[0], baseline: focusBaseline });
  assert.deepEqual(focused.failures, [], `team icon tooltip on keyboard focus: ${focused.failures.join('; ')}`);
  console.log(`PASS team icon tooltips: ${checked} hover placements across lobby/history cards, Players rows and the drawer, plus keyboard focus`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => Promise.allSettled([activeBrowser?.close(), activeServer?.close()]));
