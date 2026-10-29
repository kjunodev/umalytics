import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(process.env.DESKTOP_SHOTS_DIR ?? path.join(root, '.shots'));
await fs.mkdir(out, { recursive: true });
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0, fs: { allow: [path.resolve(root, '../..')] } },
  plugins: [{ name: 'desktop-shot-entry', transformIndexHtml: html => html.replace('/src/main.tsx', '/scripts/shots-bootstrap.mjs') }] });
let browser;
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const failures = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const origin = server.resolvedUrls.local[0];
  async function open(scene, width, height) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => failures.push(error.message));
    await page.route('https://**/*', route => { failures.push(`Unexpected network: ${route.request().url()}`); return route.abort(); });
    await page.exposeFunction('__resizeShot__', size => page.setViewportSize({ width: Math.round(size.width), height: Math.round(size.height) }));
    await page.addInitScript(scene => { window.__SHOT_SCENE__ = scene; }, scene);
    await page.goto(origin);
    await page.locator('.app-shell').waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (scene !== 'empty') {
      try { await page.waitForFunction(() => document.querySelectorAll('.rank').length === 10 && [...document.querySelectorAll('.rank')].every(chip => chip.textContent.startsWith('#')) && document.querySelectorAll('.top-umas .uma-row, .player-identity .uma-row').length >= (innerWidth < 760 ? 10 : 30)); }
      catch (error) { console.error(await page.locator('body').innerText()); throw error; }
    }
    return page;
  }
  async function shot(page, name) {
    await page.evaluate(() => document.fonts.ready);
    const errors = await page.evaluate(() => {
      const errors = [];
      if (document.documentElement.scrollWidth > innerWidth) errors.push('document horizontal overflow');
      if (document.documentElement.scrollHeight > innerHeight) errors.push('document overflow outside the scrolling content');
      for (const element of document.querySelectorAll('body *')) {
        if (!(element instanceof HTMLElement) || element.closest('[hidden], .sr-only, select, script, style') || !element.getClientRects().length) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) errors.push(`horizontal overflow: ${element.className || element.tagName} in ${element.parentElement?.className}: ${element.textContent.slice(0, 60)} (${element.scrollWidth}/${element.clientWidth})`);
        for (const node of element.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            for (let parent = element; parent; parent = parent.parentElement) {
              const ps = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
              if (['hidden', 'clip'].includes(ps.overflowX) && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) errors.push(`clipped text: ${node.textContent.trim()}`);
              if (['hidden', 'clip'].includes(ps.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) errors.push(`clipped text: ${node.textContent.trim()}`);
            }
          }
        }
      }
      return [...new Set(errors)];
    });
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    check(errors.length === 0, `${name}: ${errors.join('; ')}`);
    console.log(`PASS ${name}`);
  }
  for (const [width, height] of [[1280, 800], [1000, 700]]) {
    const page = await open('lobby', width, height);
    check(await page.locator('.player-card').count() === 10, 'Ten replay players');
    await shot(page, `lobby-${width}x${height}`);
    await page.getByRole('button', { name: 'All-time', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.player-stats')].every(stats => stats.textContent.includes('30–24')));
    check((await page.locator('.player-stats').first().innerText()).includes('56%'), 'Win rate converts the core fraction to a percentage');
    await page.getByRole('button', { name: 'Stamina', exact: true }).click();
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.locator('.stamina-chart').waitFor();
    check(await page.locator('tbody tr').count() === 6, 'Six nearby rows');
    await shot(page, `stamina-${width}x${height}`);
    await page.getByRole('button', { name: 'All values', exact: true }).click();
    check(await page.locator('tbody tr').count() === 35, 'All 35 sampled values');
    await page.getByRole('spinbutton', { name: 'Stamina', exact: true }).fill('825');
    check(await page.getByText('Inputs changed since this run', { exact: false }).isVisible(), 'Stale result notice');
    check((await page.locator('.kpi').first().innerText()).includes('800'), 'Result remains tied to submitted build');
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.kpi')?.textContent.includes('825'));
    await page.getByRole('button', { name: 'All values', exact: true }).click();
    check(await page.locator('tbody tr').count() === 36, 'Off-grid current stamina included');
    await page.locator('.edit-all summary').click();
    await page.getByRole('button', { name: '+ Add skill', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search skills' }).fill('Recovery');
    await page.getByRole('combobox', { name: 'Skill', exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Add selected skill' }).click();
    await shot(page, `stamina-edit-${width}x${height}`);
    await page.getByRole('button', { name: 'Remove skill 1' }).click();
    check(await page.locator('.skill-chip').count() === 0, 'Skills removable');
    await page.getByRole('spinbutton', { name: 'Stamina', exact: true }).fill('1200');
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.locator('.kpi.sufficient').waitFor();
    check((await page.locator('.kpi').nth(2).innerText()).includes('—'), 'Sufficient stamina has a blue tile and no positive gap');
    await page.evaluate(() => { window.__SHOT_CONTROL__.slow = true; });
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText('Simulation cancelled.', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Run check', exact: true }).isEnabled(), 'Cancellation restores form');
    await page.reload();
    await page.locator('.page-header h1').filter({ hasText: 'Stamina check' }).waitFor();
    check(await page.locator('.stamina-form').isVisible(), 'Page restored from store');
    await page.close();
  }
  const compact = await open('lobby', 440, 860);
  await shot(compact, 'compact-lobby-440x860');
  await compact.getByRole('button', { name: 'Draft', exact: true }).click();
  await shot(compact, 'compact-draft-440x860');
  check((await compact.locator('.turn-banner').innerText()).includes('Uma pick 4 of 5'), 'Turn derived from state');
  check(await compact.locator('.slot.now').count() === 1, 'Current slot highlighted');
  await compact.getByRole('button', { name: 'Pin on top', exact: true }).click();
  check(await compact.getByRole('button', { name: 'Pin on top', exact: true }).getAttribute('aria-pressed') === 'true', 'Pin toggled');
  await compact.getByRole('button', { name: 'Expand to full mode' }).click();
  check(compact.viewportSize().width === 1280, 'Expand resizes window');
  await compact.getByRole('button', { name: 'Compact', exact: true }).click();
  check(compact.viewportSize().width === 440, 'Compact resizes window');
  await compact.reload();
  await compact.getByRole('button', { name: 'Pin on top', exact: true }).waitFor();
  check(await compact.getByRole('button', { name: 'Pin on top', exact: true }).getAttribute('aria-pressed') === 'true', 'Pin persisted');
  await compact.getByRole('button', { name: 'Expand to full mode' }).click();
  check(compact.viewportSize().width === 1280, 'Previous full size persisted');
  check(await compact.locator('.draft-view').isVisible(), 'Draft page persisted');
  await compact.close();
  const empty = await open('empty', 1280, 800);
  await shot(empty, 'empty-lobby-1280x800');
  await empty.close();
  check(failures.length === 0, failures.join('\n'));
  console.log(`${checks} checks passed; screenshots: ${out}`);
} finally { await browser?.close(); await server.close(); }
