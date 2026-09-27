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
import { checkGeometry } from './geometry.mjs';

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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => Promise.allSettled([activeBrowser?.close(), activeServer?.close()]));
