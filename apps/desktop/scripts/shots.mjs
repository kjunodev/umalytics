import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
const staminaOnly = process.env.DESKTOP_SHOTS_SCENES === 'stamina';
const localIcons = process.env.UMALYTICS_GAMEDATA_DIR ?? path.join(os.homedir(), 'Documents/Coding Projects/UmaLytics-GameData/gametora');
const fixtureIcon = await fs.readFile(path.join(localIcons, 'icons/20051.webp')).catch(() => null);
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const origin = server.resolvedUrls.local[0];
  async function open(scene, width, height) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => failures.push(error.message));
    await page.route('https://**/*', route => { if (route.request().resourceType() !== 'image') failures.push(`Unexpected network: ${route.request().url()}`); return route.abort(); });
    await page.route('http://asset.localhost/**', route => fixtureIcon ? route.fulfill({ contentType: 'image/webp', body: fixtureIcon }) : route.abort());
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
        if (label.scrollWidth > label.clientWidth + 1) errors.push('KPI label overflows');
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
    if (!staminaOnly) {
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
    }
    await page.getByRole('button', { name: 'Stamina', exact: true }).click();
    await page.getByRole('button', { name: 'Race', exact: true }).click();
    check(await page.getByRole('group', { name: 'Track', exact: true }).getByRole('button').count() === 14, 'All 14 tracks');
    await page.getByRole('group', { name: 'Track', exact: true }).getByRole('button', { name: 'Hanshin', exact: true }).click();
    await page.getByRole('group', { name: 'Race', exact: true }).getByRole('button', { name: '3200 · Turf · Outer to Inner', exact: true }).click();
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.locator('.stamina-chart').waitFor();
    check(!(await page.locator('.result-table').getAttribute('open')), 'Per-stamina table collapsed by default');
    check((await page.locator('.stamina-headline').innerText()).includes('1,070'), 'Headline uses the joint threshold');
    check(await page.locator('.joint-curve').count() === 1, 'Curve includes joint outcomes');
    await shot(page, `stamina-toolbar-${width}x${height}`);
    await shot(page, `stamina-results-${width}x${height}`);
    for (const [name, file] of [['Race', 'race'], ['Ground condition', 'ground'], ['Weather', 'weather'], ['Season', 'season'], ['Advanced settings', 'advanced']]) {
      await page.getByRole('button', { name, exact: true }).click();
      await shot(page, `stamina-popover-${file}-${width}x${height}`);
      await page.keyboard.press('Escape');
      check(await page.getByRole('button', { name, exact: true }).evaluate(el => el === document.activeElement), `${name} restores focus`);
    }
    await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
    const field = page.getByRole('group', { name: 'Field', exact: true });
    check(await field.getByRole('button', { name: 'Average lobby', exact: true }).getAttribute('aria-pressed') === 'true', 'Average remains the default field');
    await field.getByRole('button', { name: 'Mirror', exact: true }).click();
    for (const [label, enabled] of [['Assume skills activate', true], ['Rushed', true], ['Spot Struggle', false], ['Dueling', false], ['Lane movement', true]]) {
      check(await page.getByRole('checkbox', { name: label, exact: true }).isChecked() === enabled, `${label} default`);
      await page.getByRole('checkbox', { name: label, exact: true }).setChecked(!enabled);
    }
    await page.getByRole('combobox', { name: 'Mood', exact: true }).selectOption('4');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Ground condition', exact: true }).click();
    await page.getByRole('group', { name: 'Ground', exact: true }).getByRole('button', { name: 'Heavy', exact: true }).click();
    await page.getByRole('button', { name: 'Weather', exact: true }).click();
    await page.getByRole('group', { name: 'Weather', exact: true }).getByRole('button', { name: 'Rainy', exact: true }).click();
    await page.getByRole('button', { name: 'Season', exact: true }).click();
    await page.getByRole('group', { name: 'Season', exact: true }).getByRole('button', { name: 'Summer', exact: true }).click();
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    const build = page.getByRole('dialog', { name: 'Build editor', exact: true });
    check(await build.getByRole('combobox', { name: 'Mood', exact: true }).inputValue() === '4', 'Mood shared by advanced settings and build');
    check(await build.locator('.aptitude-grid select').count() === 10, 'All distance, surface, and strategy aptitudes exposed');
    check(await build.locator('.aptitude-grid select').evaluateAll(els => els.every(el => el.value === '7')), 'All aptitudes default A');
    await build.getByRole('spinbutton', { name: 'Speed', exact: true }).fill('1600');
    await build.getByRole('spinbutton', { name: 'Stamina', exact: true }).fill('1120');
    await build.getByRole('spinbutton', { name: 'Power', exact: true }).fill('1200');
    await build.getByRole('spinbutton', { name: 'Wit', exact: true }).fill('1200');
    await build.getByRole('combobox', { name: 'Long aptitude', exact: true }).selectOption('8');
    await build.getByRole('group', { name: 'Strategy', exact: true }).getByRole('button', { name: 'Front', exact: true }).click();
    await shot(page, `stamina-build-${width}x${height}`);
    check((await page.locator('.stale-notice').innerText()).includes('Inputs changed'), 'Edits mark the old result stale');
    await build.getByRole('button', { name: '+ Add skill', exact: true }).click();
    const search = build.getByRole('combobox', { name: 'Search skills', exact: true });
    await search.fill('rply rcvy');
    check(await build.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').count() === 2, 'Type-ahead fuzzy subsequence match');
    await search.scrollIntoViewIfNeeded();
    await shot(page, `stamina-skill-search-${width}x${height}`);
    await search.press('Enter');
    check(await build.locator('.skill-chip.rarity-gold').count() === 1, 'Enter adds gold chip');
    check(await build.locator('.skill-level').count() === 0, 'Nonunique skill has no level control');
    if (fixtureIcon) {
      await build.locator('.skill-chip img').evaluate(img => img.decode());
      check(await build.locator('.skill-chip img').evaluate(img => img.naturalWidth > 0), 'External local icon loads');
    }
    await build.getByRole('button', { name: '+ Add skill', exact: true }).click();
    await search.fill('Unique'); await build.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').click();
    await build.getByRole('combobox', { name: 'Replay Unique level', exact: true }).selectOption('6');
    check(await build.locator('.skill-level').count() === 1, 'Only unique has a level control');
    await build.getByRole('button', { name: '+ Add skill', exact: true }).click();
    await search.fill('All Regions'); check(await build.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').count() === 0, 'Default filter excludes other regions');
    await build.getByRole('checkbox', { name: 'Show all regions', exact: true }).check();
    await build.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').click();
    await shot(page, `stamina-skills-${width}x${height}`);
    await build.getByRole('button', { name: 'Remove skill 1', exact: true }).click();
    await build.getByRole('button', { name: '+ Add skill', exact: true }).click();
    check((await build.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').first().innerText()).includes('Replay Recovery'), 'Recent skill first after removal');
    await search.press('Enter');
    await page.keyboard.press('Escape');
    check(await page.getByRole('button', { name: 'Build', exact: true }).evaluate(el => el === document.activeElement), 'Build Escape returns focus');
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.stamina-headline.insufficient'));
    await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Assume skills activate', exact: true }).check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.stamina-headline.sufficient'));
    check((await page.locator('.heal-contributions').innerText()).includes('Replay Recovery'), 'Heal contribution names included');
    await shot(page, `stamina-heal-${width}x${height}`);
    await page.locator('.result-table summary').click();
    check(await page.locator('.result-table tbody tr').count() === 18, 'Table contains all 17 curve samples and off-grid current');
    await page.locator('.result-table summary').click();
    await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Assume skills activate', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__SHOT_CONTROL__.slow = true; });
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.getByText('Mapping the curve', { exact: true }).waitFor();
    await shot(page, `stamina-progress-${width}x${height}`);
    await page.evaluate(async () => {
      const { calls, emit } = window.__SHOT_CONTROL__;
      const request_id = calls.filter(c => c.command === 'stamina_check').at(-1).args.input.request_id;
      await emit('stamina-progress', { request_id, stage: 'refining', percent: 65, completed: 544, total: 1000 });
      await emit('stamina-progress', { request_id, stage: 'mapping', percent: 30, completed: 400, total: 2000 });
      await emit('stamina-progress', { request_id: 'old-request', stage: 'done', percent: 100 });
    });
    await page.getByText('Refining thresholds', { exact: true }).waitFor();
    check(await page.getByRole('progressbar').getAttribute('value') === '65', 'Out-of-order events never move bar backwards; stale requests ignored');
    await shot(page, `stamina-refining-${width}x${height}`);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText('Simulation cancelled.', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Run check', exact: true }).isEnabled(), 'Cancellation restores Run');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('shots:stamina.json:last-inputs-v1'))?.input.build.stats.stamina === 1120);
    await page.reload();
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    check(await build.getByRole('spinbutton', { name: 'Stamina', exact: true }).inputValue() === '1120', 'Stats restored');
    check(await build.getByRole('combobox', { name: 'Long aptitude', exact: true }).inputValue() === '8', 'Aptitudes restored');
    check(await build.getByRole('combobox', { name: 'Replay Unique level', exact: true }).inputValue() === '6', 'Skills and unique levels restored');
    check(await build.getByRole('checkbox', { name: 'Show all regions', exact: true }).isChecked(), 'Skill filter restored');
    await build.getByRole('button', { name: 'Close build editor', exact: true }).click();
    check((await page.getByRole('button', { name: 'Race', exact: true }).innerText()).includes('Hanshin 3200'), 'Race restored');
    for (const name of ['Heavy', 'Rainy', 'Summer']) check((await page.locator('.condition-chips').innerText()).includes(name), `${name} condition restored`);
    await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
    check(await field.getByRole('button', { name: 'Mirror', exact: true }).getAttribute('aria-pressed') === 'true', 'Field restored');
    check(!(await page.getByRole('checkbox', { name: 'Assume skills activate', exact: true }).isChecked()), 'Engine settings restored');
    check(await page.getByRole('combobox', { name: 'Mood', exact: true }).inputValue() === '4', 'Mood restored');
    await page.keyboard.press('Escape');
    await page.close();
  }
  const noData = await open('stamina-no-data', 1000, 700);
  await noData.getByRole('button', { name: 'Stamina', exact: true }).click();
  await noData.getByRole('button', { name: 'Build', exact: true }).click();
  check(await noData.getByText('Local skill data unavailable.', { exact: false }).count() === 1, 'Missing-data notice appears once, quietly');
  await noData.getByRole('button', { name: '+ Add skill', exact: true }).click();
  await noData.getByRole('combobox', { name: 'Search skills', exact: true }).fill('All Regions');
  check(await noData.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').count() === 1, 'Fallback engine catalog remains usable without region metadata');
  check(await noData.locator('.skill-options img').count() === 0, 'No icons requested without local data');
  await shot(noData, 'stamina-no-data-1000x700');
  await noData.close();
  if (!staminaOnly) {
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
  }
  check(failures.length === 0, failures.join('\n'));
  console.log(`${checks} checks passed; screenshots: ${out}`);
} finally { await browser?.close(); await server.close(); }
