import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(process.env.DESKTOP_SHOTS_DIR ?? path.join(root, '.shots'));
await fs.mkdir(out, { recursive: true });
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0,
  watch: { ignored: ['**/src-tauri/**', '**/.shots/**'] }, fs: { allow: [path.resolve(root, '../..')] } },
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
    await page.route('https://**/*', route => { if (route.request().resourceType() !== 'image') failures.push(`Unexpected network: ${route.request().url()}`); return route.abort(); });
    await page.exposeFunction('__resizeShot__', size => page.setViewportSize({ width: Math.round(size.width), height: Math.round(size.height) }));
    await page.addInitScript(scene => { window.__SHOT_SCENE__ = scene; }, scene);
    await page.goto(origin);
    await page.locator('.app-shell').waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (scene !== 'empty') {
      try { await page.waitForFunction(() => innerWidth < 760 ? document.querySelectorAll('.rank').length === 10 && [...document.querySelectorAll('.rank')].every(chip => chip.textContent.startsWith('#')) : document.querySelectorAll('.player-list .top-umas-rows li').length === 30 && [...document.querySelectorAll('.player-rank-line')].every(line => line.textContent.startsWith('#'))); }
      catch (error) { console.error(await page.locator('body').innerText()); throw error; }
    }
    return page;
  }
  async function shot(page, name) {
    await page.evaluate(() => document.fonts.ready);
    const errors = await page.evaluate(() => {
      const errors = [];
      for (const grid of document.querySelectorAll('.player-list')) {
        if (!document.querySelector('.compact')) {
          const tops = [...grid.children].map(card => Math.round(card.getBoundingClientRect().top));
          if (new Set(tops).size > 1) errors.push('team cards wrap to a second row');
        }
      }
      for (const label of document.querySelectorAll('.kpi > .label')) {
        const range = document.createRange(); range.selectNodeContents(label);
        if (new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size > 1 || label.scrollWidth > label.clientWidth + 1) errors.push('KPI label wraps or overflows');
      }
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
            let scrollsX = false, scrollsY = false;
            for (let parent = element; parent; parent = parent.parentElement) {
              const ps = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
              if (!scrollsX && ['hidden', 'clip'].includes(ps.overflowX) && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) errors.push(`clipped text: ${node.textContent.trim()}`);
              if (!scrollsY && ['hidden', 'clip'].includes(ps.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) errors.push(`clipped text: ${node.textContent.trim()}`);
              scrollsX ||= ['auto', 'scroll'].includes(ps.overflowX);
              scrollsY ||= ['auto', 'scroll'].includes(ps.overflowY);
            }
          }
        }
      }
      for (const select of document.querySelectorAll('select')) {
        if (!select.getClientRects().length) continue;
        const style = getComputedStyle(select);
        const context = document.createElement('canvas').getContext('2d');
        context.font = style.font;
        const textWidth = Math.max(...[...select.options].map(option => context.measureText(option.text).width));
        const available = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - (style.appearance === 'none' ? 0 : 22);
        if (textWidth > available + 1) errors.push(`clipped select text: ${select.getAttribute('aria-label') ?? select.closest('label')?.textContent} (${textWidth.toFixed(1)}/${available.toFixed(1)})`);
      }
      return [...new Set(errors)];
    });
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    check(errors.length === 0, `${name}: ${errors.join('; ')}`);
    console.log(`PASS ${name}`);
  }
  for (const [width, height] of [[1280, 800], [1000, 700]]) {
    const page = await open('lobby', width, height);
    check(await page.locator('.player-list .player-row').count() === 10, 'Ten replay players');
    await shot(page, `lobby-${width}x${height}`);
    await page.getByRole('button', { name: 'All-time', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.compact-scouting-grid').length === 10 && [...document.querySelectorAll('.compact-scouting-grid')].every(stats => stats.textContent.includes('30-24')));
    check((await page.locator('.compact-scouting-grid').first().innerText()).includes('56%'), 'Win rate converts the core fraction to a percentage');
    await page.getByRole('button', { name: 'Open details for Replay Player 1', exact: true }).click();
    await page.getByText('Replay Champion', { exact: true }).waitFor();
    check(await page.locator('.player-drawer .iconbtn').evaluate(button => button.getBoundingClientRect().width === 40), 'Drawer close button uses shared styling');
    await page.locator('.drawer-history .recent-match-code').first().waitFor();
    check(await page.locator('.drawer-history .recent-match-code').count() === 5, 'Drawer loads core history pages');
    await shot(page, `drawer-${width}x${height}`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Draft', exact: true }).click();
    check(await page.locator('.draft-columns > *').count() === 3, 'Full draft has team / races / team panels');
    await shot(page, `draft-mid-${width}x${height}`);
    await page.getByRole('button', { name: 'Players', exact: true }).click();
    await page.locator('.players-row').first().waitFor();
    check(await page.locator('.players-row').count() === 10, 'Players displays leaderboard results');
    await shot(page, `players-${width}x${height}`);
    await page.getByRole('searchbox', { name: 'Search players' }).fill('Directory fixture');
    await page.getByRole('button', { name: 'Search all players', exact: true }).click();
    await page.locator('.players-search-list li').first().waitFor();
    check(await page.locator('.players-search-list li').count() === 10, 'Players displays core directory search results');
    await shot(page, `players-search-${width}x${height}`);
    await page.locator('.players-search-list button').first().click();
    await page.getByText('Replay Champion', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.player-drawer .drawer-stat-row')?.textContent.includes('30-24'));
    check((await page.locator('.player-drawer .drawer-stat-row').innerText()).includes('30-24'), 'Players drawer uses the header All-time scope');
    await page.keyboard.press('Escape');
    check(await page.getByRole('button', { name: 'Replay Player 1', exact: true }).isVisible(), 'Viewed player is stored as a recent chip');
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.getByRole('textbox', { name: 'Match code' }).fill('ABC123');
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await page.locator('.history-scene .draft-scene').waitFor();
    check(await page.locator('.history-scene .draft-race-card:not(.placeholder)').count() === 2, 'History displays the saved races');
    await shot(page, `history-match-${width}x${height}`);
    await page.getByRole('group', { name: 'History view' }).getByRole('button', { name: 'Lobby', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.history-scene .top-umas-rows li').length === 30);
    await shot(page, `history-lobby-${width}x${height}`);
    await page.locator('.sidebar').getByRole('button', { name: 'Umas', exact: true }).click();
    await page.locator('.uma-catalog-button').first().waitFor();
    await shot(page, `umas-${width}x${height}`);
    await page.getByRole('button', { name: 'Stamina', exact: true }).click();
    check(await page.getByRole('group', { name: 'Track', exact: true }).getByRole('button').count() === new Set((await import('./shots-fixture.mjs')).catalog.courses.map(c => c.track_name)).size, 'All pool tracks available');
    for (const [label, names] of [['Ground', ['Firm', 'Good', 'Soft', 'Heavy']], ['Weather', ['Sunny', 'Cloudy', 'Rainy', 'Snowy']], ['Season', ['Spring', 'Summer', 'Fall', 'Winter']]]) {
      for (const name of names) {
        const button = page.getByRole('group', { name: label, exact: true }).getByRole('button', { name, exact: true });
        await button.click();
        check(await button.getAttribute('aria-pressed') === 'true', label + ' exact choice ' + name);
      }
    }
    await page.getByRole('group', { name: 'Track', exact: true }).getByRole('button', { name: 'Morioka', exact: true }).click();
    await page.getByRole('group', { name: 'Race', exact: true }).getByRole('button', { name: '2000 · Dirt · Unavailable', exact: true }).click();
    check(await page.getByRole('button', { name: 'Run check', exact: true }).isDisabled(), 'Missing geometry disables simulation');
    check(await page.getByText('Engine course geometry missing: courseeventparam 11504.', { exact: true }).isVisible(), 'Unavailability has an explicit reason');
    await page.getByRole('group', { name: 'Track', exact: true }).getByRole('button', { name: 'Hanshin', exact: true }).click();
    await page.getByRole('group', { name: 'Race', exact: true }).getByRole('button', { name: '3200 · Turf · Outer to Inner', exact: true }).click();
    check(await page.getByRole('group', { name: 'Field', exact: true }).getByRole('button', { name: 'Average lobby', exact: true }).getAttribute('aria-pressed') === 'true', 'Average lobby defaults on');
    await page.getByRole('group', { name: 'Field', exact: true }).getByRole('button', { name: '2-runner (skill position conditions see 2 runners)', exact: true }).click();
    check(await page.getByRole('group', { name: 'Field', exact: true }).getByRole('button', { name: '2-runner (skill position conditions see 2 runners)', exact: true }).getAttribute('aria-pressed') === 'true', '2-runner option remains selectable with explicit condition semantics');
    await page.getByRole('group', { name: 'Field', exact: true }).getByRole('button', { name: 'Average lobby', exact: true }).click();
    check(await page.getByRole('group', { name: 'Field', exact: true }).getByRole('button', { name: 'Average lobby', exact: true }).getAttribute('aria-pressed') === 'true', 'Average lobby selectable');
    await page.getByRole('group', { name: 'Field', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await shot(page, `stamina-field-${width}x${height}`);
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.locator('.stamina-chart').waitFor();
    check(await page.getByRole('group', { name: 'Assume heals activate', exact: true }).getByRole('button', { name: 'On', exact: true }).getAttribute('aria-pressed') === 'true', 'Heal lottery assumption defaults on');
    check((await page.locator('.unconditional-rates').innerText()).includes('256 heal-lottery passes / 256 simulated'), 'Current rates use the full bank');

    check(await page.locator('tbody tr').count() === 6, 'Six nearby rows');
    await shot(page, `stamina-controls-${width}x${height}`);
    await page.locator('.content').evaluate(element => { element.scrollTop = 0; });
    await shot(page, `stamina-${width}x${height}`);
    await page.getByRole('button', { name: 'All values', exact: true }).click();
    check(await page.locator('tbody tr').count() === 17, 'All 17 sampled values');
    await page.getByRole('spinbutton', { name: 'Stamina', exact: true }).fill('825');
    check(await page.getByText('Inputs changed since this run', { exact: false }).isVisible(), 'Stale result notice');
    check((await page.locator('.kpi').first().innerText()).includes('800'), 'Result remains tied to submitted build');
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.kpi')?.textContent.includes('825'));
    await page.getByRole('button', { name: 'All values', exact: true }).click();
    check(await page.locator('tbody tr').count() === 18, 'Off-grid current stamina included');
    await page.locator('.edit-all summary').click();
    await page.getByRole('button', { name: '+ Add skill', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search skills' }).fill('Recovery');
    await page.getByRole('combobox', { name: 'Skill', exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Add selected skill' }).click();
    await shot(page, `stamina-edit-${width}x${height}`);
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.unconditional-rates')?.textContent.includes('512 heal-lottery passes / 554 simulated'));
    check((await page.locator('.kpi').first().innerText()).includes('512'), 'Healed current rates use a full conditional bank');
    await page.locator('.content').evaluate(element => { element.scrollTop = 0; });
    await shot(page, `stamina-heal-${width}x${height}`);
    await page.getByRole('group', { name: 'Assume heals activate', exact: true }).getByRole('button', { name: 'Off', exact: true }).click();
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.unconditional-rates')?.textContent.includes('474 heal-lottery passes / 512 simulated'));
    check((await page.locator('.kpi').first().innerText()).includes('512'), 'Unconditional current rates still use the full bank');
    await page.getByRole('group', { name: 'Assume heals activate', exact: true }).getByRole('button', { name: 'On', exact: true }).click();
    await page.getByRole('button', { name: 'Remove skill 1' }).click();
    check(await page.locator('.skill-chip').count() === 0, 'Skills removable');
    await page.getByRole('group', { name: 'Assume heals activate', exact: true }).getByRole('button', { name: 'Off', exact: true }).click();
    check(await page.getByRole('group', { name: 'Assume heals activate', exact: true }).getByRole('button', { name: 'Off', exact: true }).getAttribute('aria-pressed') === 'true', 'Unconditional mode selectable');
    await page.getByRole('group', { name: 'Assume heals activate', exact: true }).getByRole('button', { name: 'On', exact: true }).click();

    await page.getByRole('spinbutton', { name: 'Stamina', exact: true }).fill('1200');
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.locator('.kpi.sufficient').waitFor();
    check((await page.locator('.kpi').nth(2).innerText()).toLowerCase().includes('90% survival'), 'Both 90% thresholds displayed');
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
  check((await compact.locator('.team-heading .num').first().innerText()).includes('1688'), 'Compact and shared cards use the same conservative team rating');
  await shot(compact, 'compact-lobby-440x860');
  await compact.getByRole('button', { name: 'Open details for Replay Player 1', exact: true }).click();
  await compact.getByText('Replay Champion', { exact: true }).waitFor();
  check(await compact.locator('.player-drawer .iconbtn').evaluate(button => button.getBoundingClientRect().width === 40), 'Compact drawer close button uses shared styling');
  await compact.locator('.drawer-history .recent-match-code').first().waitFor();
  check(await compact.locator('.player-drawer').evaluate(element => element.getBoundingClientRect().width === innerWidth), 'Compact drawer is full width');
  await shot(compact, 'compact-drawer-440x860');
  await compact.keyboard.press('Escape');
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
  await compact.locator('.draft-scene').waitFor();
  check(await compact.locator('.draft-scene').isVisible(), 'Draft page persisted');
  await compact.close();
  const minimum = await open('lobby', 760, 800);
  await shot(minimum, 'lobby-760x800');
  await minimum.close();
  const empty = await open('empty', 1280, 800);
  await shot(empty, 'empty-lobby-1280x800');
  await empty.close();
  check(failures.length === 0, failures.join('\n'));
  console.log(`${checks} checks passed; screenshots: ${out}`);
} finally { await browser?.close(); await server.close(); }
