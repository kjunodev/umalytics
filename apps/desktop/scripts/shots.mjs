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
const server = await createServer({ root, cacheDir: path.join(out, '.vite'), configFile: false, server: { host: '127.0.0.1', port: 0,
  watch: { ignored: ['**/src-tauri/**', '**/.shots/**'] }, fs: { allow: [path.resolve(root, '../..')] } },
  plugins: [{ name: 'desktop-shot-entry', transformIndexHtml: html => html.replace('/src/main.tsx', '/scripts/shots-bootstrap.mjs') }] });
let browser;
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const failures = [];
const staminaOnly = process.env.DESKTOP_SHOTS_SCENES === 'stamina';
const arenaOnly = process.env.DESKTOP_SHOTS_SCENES === 'arena';
const statesOnly = process.env.DESKTOP_SHOTS_SCENES === 'states';
const dataOnly = process.env.DESKTOP_SHOTS_SCENES === 'data';
const usabilityOnly = process.env.DESKTOP_SHOTS_SCENES === 'usability';
const localIcons = process.env.UMALYTICS_GAMEDATA_DIR ?? path.join(os.homedir(), 'Documents/Coding Projects/UmaLytics-GameData/gametora');
const fixtureIcon = await fs.readFile(path.join(localIcons, 'icons/20051.webp')).catch(() => null);
const portraitDir = process.env.DESKTOP_SHOTS_PORTRAITS;
const teamLogo = await fs.readFile(path.join(root, 'src-tauri/icons/icon.png'));
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const origin = server.resolvedUrls.local[0];
  async function nav(page, name) {
    if (['Lobby', 'Draft', 'Umas'].includes(name)) {
      if (await page.locator('.sidebar').count()) await page.locator('.sidebar').getByRole('button', { name: 'Live', exact: true }).click();
      await page.getByRole('group', { name: 'Live view', exact: true }).getByRole('button', { name, exact: true }).click();
    } else await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
  }
  async function open(scene, width, height) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => failures.push(error.message));
    await page.route('https://**/*', async route => {
      if (route.request().resourceType() !== 'image') failures.push(`Unexpected network: ${route.request().url()}`);
      const filename = new URL(route.request().url()).pathname.split('/').at(-1);
      if (filename === 'fixture-team.png') return route.fulfill({ contentType: 'image/png', body: teamLogo });
      const portrait = portraitDir && /^chara_stand_\d{4}_\d{6}\.webp$/.test(filename) ? await fs.readFile(path.join(portraitDir, filename)).catch(() => null) : null;
      return portrait ? route.fulfill({ contentType: 'image/webp', body: portrait }) : route.abort();
    });
    await page.route('http://asset.localhost/**', route => fixtureIcon ? route.fulfill({ contentType: 'image/webp', body: fixtureIcon }) : route.abort());
    await page.exposeFunction('__resizeShot__', size => page.setViewportSize({ width: Math.round(size.width), height: Math.round(size.height) }));
    await page.addInitScript(scene => { window.__SHOT_SCENE__ = scene; }, scene);
    await page.goto(origin);
    await page.locator('.app-shell').waitFor();
    await page.waitForFunction(() => window.__SHOT_CONTROL__.feedReady);
    await nav(page, 'Lobby');
    await page.evaluate(() => document.fonts.ready);
    if (scene === 'lobby' || scene === 'stamina-no-data') {
      try { await page.waitForFunction(() => document.querySelectorAll('.rank').length === 10 && [...document.querySelectorAll('.rank')].every(chip => chip.textContent.startsWith('#'))); }
      catch (error) { console.error(await page.locator('body').innerText()); throw error; }
    }
    return page;
  }
  async function shot(page, name) {
    await page.mouse.move(page.viewportSize().width - 8, 8);
    await page.evaluate(() => document.fonts.ready);
    const errors = await page.evaluate(() => {
      const errors = [];
      for (const grid of document.querySelectorAll('.player-list')) {
        if (!document.querySelector('.compact') && innerWidth / (Number(getComputedStyle(document.documentElement).zoom) || 1) >= 1000) {
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
  for (const [width, height] of (statesOnly || usabilityOnly) ? [] : [[1280, 800], [1000, 700]]) {
    const page = await open('lobby', width, height);
    if (!staminaOnly) {
    check(await page.locator('.player-list .player-row').count() === 10, 'Ten replay players');
    check(await page.locator('.arena-card.top10').count() === 5 && await page.locator('.arena-card.top25').count() === 5, 'Gold Top 10 and silver Top 25 cards use actual leaderboard rank');
    await shot(page, `lobby-${width}x${height}`);
    await page.getByRole('button', { name: 'All-time', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.compact-scouting-grid').length === 10 && [...document.querySelectorAll('.compact-scouting-grid')].every(stats => stats.textContent.includes('30-24')));
    check((await page.locator('.compact-scouting-grid').first().innerText()).includes('56%'), 'Win rate converts the core fraction to a percentage');
    await page.getByRole('button', { name: 'Open details for Replay Player 1', exact: true }).click();
    await page.getByText('Replay Champion', { exact: true }).waitFor();
    check(await page.locator('.player-drawer .iconbtn').evaluate(button => button.getBoundingClientRect().width === 40), 'Drawer close button uses shared styling');
    await page.locator('.drawer-history .recent-match-code').first().waitFor();
    check(await page.locator('.drawer-history .recent-match-code').count() === 5, 'Drawer loads core history pages');
    check(await page.locator('.drawer-badges').getByText('Podium regular', { exact: true }).isVisible(), 'Drawer badges use full labels');
    await shot(page, `drawer-${width}x${height}`);
    check(await page.locator('.arena-player-drawer').evaluate(el => el.getBoundingClientRect().width === 600), 'Drawer is 600 CSS pixels');
    const pagerTop = await page.locator('.data-pager').evaluate(el => el.getBoundingClientRect().top);
    await page.getByRole('button', { name: 'Page 2', exact: true }).click();
    check(await page.locator('.drawer-history .recent-match-code').count() === 1, 'History page 2 has the remaining match');
    check(await page.locator('.data-pager').evaluate(el => el.getBoundingClientRect().top) === pagerTop, 'Pager stays fixed on a short history page');
    await shot(page, `drawer-page2-${width}x${height}`);
    await page.getByRole('button', { name: 'Page 1', exact: true }).click();
    await page.getByRole('button', { name: 'Show all', exact: true }).click();
    check(await page.locator('[aria-label="Player Uma stats"] tbody tr').count() === 4, 'Low-game Uma toggle reveals the fourth Uma');
    await shot(page, `drawer-low-games-${width}x${height}`);
    await page.getByRole('button', { name: 'Hide <3 games', exact: true }).click();
    await page.keyboard.press('Escape');
    await nav(page, 'Draft');
    check(await page.locator('.draft-columns > *').count() === 3, 'Full draft has team / races / team panels');
    await shot(page, `draft-mid-${width}x${height}`);
    await page.getByRole('button', { name: 'Players', exact: true }).click();
    await page.locator('.table-player').first().waitFor();
    check(await page.locator('.table-player').count() === 20, 'Players paginates the leaderboard');
    await shot(page, `players-${width}x${height}`);
    await page.getByRole('searchbox', { name: 'Search players' }).fill('Replay Player');
    check(await page.locator('.table-player').count() === 10, 'Search filters leaderboard rows');
    await shot(page, `players-search-${width}x${height}`);
    await page.getByRole('searchbox', { name: 'Search players' }).fill('Directory fixture');
    await page.getByRole('button', { name: 'Search all players', exact: true }).click();
    await page.locator('.data-empty').getByRole('button', { name: 'Replay Player 1', exact: true }).click();
    await page.getByText('Replay Champion', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.player-drawer .drawer-stat-strip')?.textContent.includes('212-119'));
    check((await page.locator('.player-drawer .drawer-stat-strip').innerText()).includes('212-119'), 'Season leaderboard drawer uses season stats');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await shot(page, `history-list-${width}x${height}`);
    await page.getByRole('textbox', { name: 'Match code or URL' }).fill('ABC123');
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await page.locator('[aria-label="History"] .draft-scene').waitFor();
    check(await page.locator('[aria-label="History"] .arena-race:not(.pending)').count() === 2, 'History displays the saved races');
    await shot(page, `history-match-${width}x${height}`);
    await page.getByRole('group', { name: 'Match view' }).getByRole('button', { name: 'Lobby', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="History"] .top-umas-rows li').length === 30);
    check(await page.locator('[aria-label="History"] .arena-card').evaluateAll(cards => new Set(cards.map(c => Math.round(c.getBoundingClientRect().height))).size) === 1, 'Historical Arena player cards have equal heights');
    await shot(page, `history-lobby-${width}x${height}`);
    await page.getByRole('group', { name: 'Match view' }).getByRole('button', { name: 'Umas', exact: true }).click();
    await shot(page, `history-umas-${width}x${height}`);
    await page.getByRole('button', { name: '← Matches', exact: true }).click();
    check(await page.locator('[aria-label="Recently opened matches"] tbody tr').count() === 1, 'Successful lookup remembers a display-only local label');
    await shot(page, `history-recent-${width}x${height}`);
    await page.reload();
    await page.getByRole('button', { name: 'ABC123', exact: true }).waitFor();
    check(await page.locator('[aria-label="Recently opened matches"] tbody tr').count() === 1, 'Recently opened persists across reload');
    await page.getByRole('button', { name: 'Clear recently opened', exact: true }).click();
    check(await page.locator('[aria-label="Recently opened matches"] tbody tr').count() === 0, 'Recently opened is clearable');
    await nav(page, 'Umas');
    await page.locator('.arena-uma-catalog button').first().waitFor();
    await shot(page, `umas-${width}x${height}`);
    await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('Found', { exact: true }).waitFor();
    await shot(page, `settings-${width}x${height}`);
    await page.locator('.content').evaluate(el => { el.scrollTop = el.scrollHeight; });
    check(await page.getByText('Update checks arrive with the first desktop release', { exact: true }).isVisible(), 'About uses a local version notice');
    await shot(page, `settings-about-${width}x${height}`);
    await page.locator('.content').evaluate(el => { el.scrollTop = 0; });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click();
    await page.getByText('Diagnostics copied', { exact: true }).waitFor();
    check(!/100000000000000|CAS7R1|token|discord/i.test(await page.evaluate(() => navigator.clipboard.readText())), 'Settings diagnostics use the counts-only port screen payload');
    await page.getByRole('group', { name: 'Default stamina target' }).getByRole('button', { name: '99%', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Compact switch width' }).fill('610');
    await page.getByRole('spinbutton', { name: 'Compact switch width' }).press('Enter');
    for (const size of ['Small', 'Large', 'Default']) {
      await page.getByRole('group', { name: 'UI size' }).getByRole('button', { name: size, exact: true }).click();
      await shot(page, `settings-${size.toLowerCase()}-${width}x${height}`);
      if (size === 'Large') {
        await nav(page, 'Lobby');
        await shot(page, `lobby-large-${width}x${height}`);
        await page.getByRole('button', { name: 'Open details for Replay Player 1', exact: true }).click();
        await page.locator('.drawer-history .recent-match-code').first().waitFor();
        await shot(page, `drawer-large-${width}x${height}`);
        await page.keyboard.press('Escape');
        await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
      }
    }
    await page.reload();
    check(await page.getByRole('spinbutton', { name: 'Compact switch width' }).inputValue() === '610', 'Compact threshold persists');
    check(await page.getByRole('group', { name: 'Default stamina target' }).getByRole('button', { name: '99%', exact: true }).getAttribute('aria-pressed') === 'true', 'Stamina default persists');
    await page.getByRole('spinbutton', { name: 'Compact switch width' }).fill('600');
    await page.getByRole('spinbutton', { name: 'Compact switch width' }).press('Enter');
    await page.getByRole('group', { name: 'Default stamina target' }).getByRole('button', { name: '90%', exact: true }).click();
    }
    if (!arenaOnly && !dataOnly) {
    await page.getByRole('button', { name: 'Stamina', exact: true }).click();
    await shot(page, `stamina-empty-${width}x${height}`);
    await page.getByRole('button', { name: 'Race', exact: true }).click();
    check(await page.getByRole('group', { name: 'Track', exact: true }).getByRole('button').count() === 14, 'All 14 tracks');
    await page.getByRole('group', { name: 'Track', exact: true }).getByRole('button', { name: 'Hanshin', exact: true }).click();
    await page.getByRole('group', { name: 'Race', exact: true }).getByRole('button', { name: '3200 · Turf · Outer to Inner', exact: true }).click();
    await page.getByRole('button', { name: /^Run (check|\d+ races)$/ }).click();
    await page.locator('.stamina-chart').waitFor();
    check(!(await page.locator('.result-table').getAttribute('open')), 'Per-stamina table collapsed by default');
    check((await page.locator('.stamina-headline').innerText()).includes('1,070'), 'Headline uses the joint threshold');
    check(await page.locator('.joint-curve').count() === 1, 'Curve includes joint outcomes');
    await shot(page, `stamina-toolbar-${width}x${height}`);
    await shot(page, `stamina-results-${width}x${height}`);
    const resultTop = await page.locator('.stamina-headline').evaluate(el => el.getBoundingClientRect().top);
    await page.getByRole('button', { name: 'Edit build', exact: true }).click();
    check(await page.locator('.stamina-workspace').evaluate(el => el.querySelector('.stamina-results').getBoundingClientRect().right <= el.querySelector('.build-drawer').getBoundingClientRect().left), 'Dock sits beside results without covering them');
    check(await page.locator('.stamina-headline').evaluate(el => el.getBoundingClientRect().top) === resultTop, 'Opening the dock keeps the results top stable');
    await shot(page, `stamina-results-panel-${width}x${height}`);
    await page.setViewportSize({ width: width === 1000 ? 1280 : 1000, height });
    check(await page.locator('.stamina-workspace').evaluate(el => el.scrollWidth <= el.clientWidth), 'Open dock reflows on resize');
    await page.setViewportSize({ width, height });
    await page.keyboard.press('Escape');
    for (const [name, file] of [['Race', 'race'], ['Ground condition', 'ground'], ['Weather', 'weather'], ['Season', 'season']]) {
      await page.getByRole('button', { name, exact: true }).click();
      await shot(page, `stamina-popover-${file}-${width}x${height}`);
      await page.keyboard.press('Escape');
      check(await page.getByRole('button', { name, exact: true }).evaluate(el => el === document.activeElement), `${name} restores focus`);
    }
    await page.getByRole('button', { name: 'Race settings', exact: true }).click();
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
    await page.getByRole('button', { name: 'Edit build', exact: true }).click();
    const build = page.getByRole('complementary', { name: 'Build editor', exact: true });
    await build.getByRole('tab', { name: 'Race settings', exact: true }).click();
    check(await build.getByRole('combobox', { name: 'Mood', exact: true }).inputValue() === '4', 'Mood shared by advanced settings and build');
    await build.getByRole('tab', { name: 'Build', exact: true }).click();
    check(await build.locator('.aptitude-grid select[aria-label$="aptitude"]').count() === 10, 'All distance, surface, and strategy aptitudes exposed');
    check(await build.locator('.aptitude-grid select[aria-label$="aptitude"]').evaluateAll(els => els.every(el => el.value === '7')), 'All aptitudes default A');
    await build.getByRole('spinbutton', { name: 'Speed', exact: true }).fill('1600');
    await build.getByRole('spinbutton', { name: 'Stamina', exact: true }).fill('1120');
    await build.getByRole('spinbutton', { name: 'Power', exact: true }).fill('1200');
    await build.getByRole('spinbutton', { name: 'Wit', exact: true }).fill('1200');
    await build.getByRole('combobox', { name: 'Long aptitude', exact: true }).selectOption('8');
    await build.getByRole('group', { name: 'Strategy', exact: true }).getByRole('button', { name: 'Front', exact: true }).click();
    await shot(page, `stamina-build-${width}x${height}`);
    check((await page.locator('.stale-notice').innerText()).includes('Inputs changed'), 'Edits mark the old result stale');
    await build.getByRole('button', { name: '+ Add skill', exact: true }).first().click();
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
    await build.getByRole('button', { name: '+ Add skill', exact: true }).last().click();
    await search.fill('Unique'); await build.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').click();
    await build.getByRole('combobox', { name: 'Replay Unique level', exact: true }).selectOption('6');
    check(await build.locator('.skill-level').count() === 1, 'Only unique has a level control');
    await build.getByRole('button', { name: '+ Add skill', exact: true }).first().click();
    await search.fill('Straightaways ◎'); check(await build.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').count() === 1, 'Double circle skill visible without source metadata');
    await build.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').click();
    await shot(page, `stamina-skills-${width}x${height}`);
    await build.getByRole('button', { name: 'Remove skill 1', exact: true }).click();
    await build.getByRole('button', { name: '+ Add skill', exact: true }).first().click();
    check((await build.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').first().innerText()).includes('Replay Recovery'), 'Recent skill first after removal');
    await search.press('Enter');
    await page.keyboard.press('Escape');
    check(await page.getByRole('button', { name: 'Edit build', exact: true }).evaluate(el => el === document.activeElement), 'Build Escape returns focus');
    await page.getByRole('button', { name: /^Run (check|\d+ races)$/ }).click();
    await page.waitForFunction(() => document.querySelector('.stamina-headline.insufficient'));
    await page.getByRole('button', { name: 'Race settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Assume skills activate', exact: true }).check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Run (check|\d+ races)$/ }).click();
    await page.waitForFunction(() => document.querySelector('.stamina-headline.sufficient'));
    check((await page.locator('.heal-contributions').innerText()).includes('Replay Recovery'), 'Heal contribution names included');
    await shot(page, `stamina-heal-${width}x${height}`);
    await page.getByRole('button', { name: 'Edit build', exact: true }).click();
    await shot(page, `stamina-results-panel-populated-${width}x${height}`);
    await page.keyboard.press('Escape');
    await page.locator('.result-table summary').click();
    check(await page.locator('.result-table tbody tr').count() === 18, 'Table contains all 17 curve samples and off-grid current');
    await page.locator('.result-table').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot(page, `stamina-table-${width}x${height}`);
    await page.locator('.result-table summary').click();
    await page.getByRole('button', { name: 'Race settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Assume skills activate', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Edit build', exact: true }).click();
    await page.evaluate(() => { window.__SHOT_CONTROL__.slow = true; });
    await page.getByRole('button', { name: /^Run (check|\d+ races)$/ }).click();
    await page.getByText('Mapping the curve', { exact: true }).waitFor();
    check(await build.getByRole('spinbutton', { name: 'Stamina', exact: true }).isDisabled(), 'Build inputs are locked during a run');
    check(await build.getByRole('tab', { name: 'Presets', exact: true }).isDisabled(), 'Preset tab locked during a run');
    check(await page.getByRole('button', { name: 'Cancel', exact: true }).isEnabled(), 'Toolbar Cancel remains available');
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
    check(await page.getByRole('button', { name: /^Run (check|\d+ races)$/ }).isEnabled(), 'Cancellation restores Run');
    await shot(page, `stamina-cancelled-${width}x${height}`);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('shots:stamina.json:last-inputs-v1'))?.input.build.stats.stamina === 1120);
    await page.reload();
    await page.getByRole('button', { name: 'Edit build', exact: true }).click();
    check(await build.getByRole('spinbutton', { name: 'Stamina', exact: true }).inputValue() === '1120', 'Stats restored');
    check(await build.getByRole('combobox', { name: 'Long aptitude', exact: true }).inputValue() === '8', 'Aptitudes restored');
    check(await build.getByRole('combobox', { name: 'Replay Unique level', exact: true }).inputValue() === '6', 'Skills and unique levels restored');
    check(await build.getByRole('checkbox', { name: 'Show all regions', exact: true }).count() === 0, 'Region filter removed');
    await build.getByRole('button', { name: 'Close build editor', exact: true }).click();
    check((await page.getByRole('button', { name: 'Race', exact: true }).innerText()).includes('Hanshin 3200'), 'Race restored');
    for (const name of ['Heavy', 'Rainy', 'Summer']) check((await page.locator('.condition-chips').innerText()).includes(name), `${name} condition restored`);
    await page.getByRole('button', { name: 'Race settings', exact: true }).click();
    check(await field.getByRole('button', { name: 'Mirror', exact: true }).getAttribute('aria-pressed') === 'true', 'Field restored');
    check(!(await page.getByRole('checkbox', { name: 'Assume skills activate', exact: true }).isChecked()), 'Engine settings restored');
    check(await page.getByRole('combobox', { name: 'Mood', exact: true }).inputValue() === '4', 'Mood restored');
    await page.keyboard.press('Escape');
    // Round 2b: independent inputs, presets, targets and a real feed-shaped draft fixture.
    await page.getByRole('button', { name: 'Race settings', exact: true }).click();
    await page.getByRole('group', { name: 'Target', exact: true }).getByRole('button', { name: '95%', exact: true }).click();
    await shot(page, 'stamina-target-95-' + width + 'x' + height);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Run (check|\d+ races)$/ }).click();
    await page.getByText('95% full spurt + survival · same races', { exact: true }).waitFor();
    check((await page.locator('.chart-heading').innerText()).includes('95%'), 'Chart target follows setting');
    await page.getByRole('button', { name: 'Edit build', exact: true }).click();
    await build.getByRole('tab', { name: 'Presets', exact: true }).click();
    await build.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Long draft');
    await build.getByRole('button', { name: 'Save current build', exact: true }).click();
    await build.getByRole('button', { name: 'Rename', exact: true }).click();
    await build.getByRole('textbox', { name: 'New preset name', exact: true }).fill('Saved front');
    await build.getByRole('button', { name: 'Save name', exact: true }).click();
    await build.getByRole('button', { name: 'Duplicate', exact: true }).click();
    const copy = build.locator('.saved-build').filter({ hasText: 'Saved front (copy)' });
    await copy.getByRole('button', { name: 'Delete', exact: true }).click();
    check(await copy.getByRole('button', { name: 'Keep preset', exact: true }).isVisible(), 'Delete requires confirmation');
    await copy.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    check(await build.locator('.saved-build').count() === 1, 'Duplicate and confirmed delete');
    await build.locator('.build-body').evaluate(el => { el.scrollTop = 0; });
    await shot(page, 'stamina-presets-' + width + 'x' + height);
    await build.getByRole('button', { name: 'Edit Front kit', exact: true }).click();
    await build.getByRole('button', { name: 'Remove skill 200531', exact: true }).click();
    const kit = build.locator('.kit-editor');
    await kit.getByRole('button', { name: '+ Add skill', exact: true }).click();
    await kit.getByRole('combobox', { name: 'Search skills', exact: true }).fill('Straightaways ◎');
    await kit.getByRole('option', { name: 'Front Runner Straightaways ◎' }).click();
    await kit.getByRole('heading').scrollIntoViewIfNeeded();
    await shot(page, 'stamina-kit-editor-' + width + 'x' + height);
    await build.getByRole('button', { name: 'Ballpark Front', exact: true }).click();
    check(await build.getByRole('spinbutton', { name: 'Speed', exact: true }).inputValue() === '1600', 'Ballpark stats');
    check(await build.getByRole('spinbutton', { name: 'Stamina', exact: true }).inputValue() === '1120', 'Ballpark keeps stamina');
    check(await build.locator('.skill-level').count() === 0, 'Ballpark clears user unique');
    check(await build.getByRole('button', { name: 'Remove skill 201241', exact: true }).count() === 1, 'Ballpark applies edited role kit');
    await shot(page, 'stamina-ballpark-' + width + 'x' + height);
    await build.getByRole('tab', { name: 'Presets', exact: true }).click();
    await build.getByRole('button', { name: 'Ballpark Runaway', exact: true }).click();
    check(await build.getByRole('group', { name: 'Strategy', exact: true }).getByRole('button', { name: 'Runaway', exact: true }).getAttribute('aria-pressed') === 'true', 'Runaway strategy derived from skill');
    check(await build.getByRole('button', { name: 'Remove skill 202051', exact: true }).count() === 1, 'Runaway skill included');
    await shot(page, 'stamina-runaway-' + width + 'x' + height);
    await build.getByRole('button', { name: '+ Add skill', exact: true }).first().click();
    await search.fill('Straightaways ◎');
    await search.scrollIntoViewIfNeeded();
    await shot(page, 'stamina-double-circle-' + width + 'x' + height);
    await page.keyboard.press('Escape');
    await build.getByRole('tab', { name: 'Presets', exact: true }).click();
    await build.getByRole('button', { name: 'Load Saved front', exact: true }).click();
    check(await build.getByRole('combobox', { name: 'Replay Unique level', exact: true }).inputValue() === '6', 'Preset load restores user unique');
    await build.getByRole('tab', { name: 'Presets', exact: true }).click();
    await build.locator('.ballpark-defaults summary').click();
    await build.getByRole('spinbutton', { name: 'Default speed', exact: true }).fill('1550');
    await build.getByRole('combobox', { name: 'Default mood', exact: true }).selectOption('4');
    await build.getByRole('combobox', { name: 'Default Long aptitude', exact: true }).selectOption('8');
    await build.getByRole('button', { name: 'Ballpark Pace', exact: true }).click();
    check(await build.getByRole('spinbutton', { name: 'Speed', exact: true }).inputValue() === '1550', 'Edited ballpark speed applied');
    await build.getByRole('tab', { name: 'Race settings', exact: true }).click();
    check(await build.getByRole('combobox', { name: 'Mood', exact: true }).inputValue() === '4', 'Edited ballpark mood applied');
    await build.getByRole('tab', { name: 'Build', exact: true }).click();
    check(await build.getByRole('combobox', { name: 'Long aptitude', exact: true }).inputValue() === '8', 'Edited ballpark aptitude applied');
    await build.getByRole('tab', { name: 'Presets', exact: true }).click();
    await build.locator('.ballpark-defaults summary').click();
    await build.getByRole('button', { name: 'Reset ballpark defaults', exact: true }).click();
    await build.getByRole('button', { name: 'Load Saved front', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Edit build', exact: true }).click();
    await build.getByRole('tab', { name: 'Presets', exact: true }).click();
    check(await build.getByRole('button', { name: 'Load Saved front', exact: true }).count() === 1, 'Saved preset persists');
    await build.getByRole('button', { name: 'Edit Front kit', exact: true }).click();
    check(await build.getByRole('button', { name: 'Remove skill 201241', exact: true }).count() === 1, 'Kit edits persist');
    await build.getByRole('button', { name: 'Reset Front kit to default', exact: true }).click();
    check(await build.getByRole('button', { name: 'Remove skill 200531', exact: true }).count() === 1, 'Reset restores bundled kit');
    await page.keyboard.press('Escape');
    await page.evaluate(async () => { const c = window.__SHOT_CONTROL__; await c.emit('feed-message', c.draftMessage(true)); });
    await page.getByRole('group', { name: 'Course mode', exact: true }).getByRole('button', { name: 'Draft', exact: true }).click();
    check(await page.locator('.draft-races > div > button').count() === 7, 'Partial draft pads seven slots');
    check(await page.locator('.draft-races').getByText('Awaiting draft race', { exact: false }).count() === 6, 'Partial draft has six placeholders');
    await shot(page, 'stamina-partial-draft-' + width + 'x' + height);
    await page.evaluate(async () => { const c = window.__SHOT_CONTROL__, message = c.draftMessage(true, 1002); message.event.state.team1.pickedMaps[0].id = 'unknown'; message.event.state.team1.pickedMaps[0].track = 'Unknown fixture course'; await c.emit('feed-message', message); });
    await page.getByText('Unknown course', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: /^Run (check|\d+ races)$/ }).isDisabled(), 'Unresolved draft never guesses a course');
    check((await page.locator('.draft-races').innerText()).includes('Unknown fixture course'), 'Unknown course preserves raw text');
    await shot(page, 'stamina-unknown-draft-' + width + 'x' + height);
    const unknownMessage = await page.evaluate(() => { const c = window.__SHOT_CONTROL__; const m = c.draftMessage(true, 1002); m.event.state.team1.pickedMaps[0].id = 'unknown'; m.event.state.team1.pickedMaps[0].track = 'Unknown fixture course'; return m; });
    await page.getByRole('button', { name: 'Choose the course', exact: true }).click();
    const poolPicker = page.getByRole('dialog', { name: 'Choose the course', exact: true });
    check(await poolPicker.locator('.pool-course-options button').count() === 104, 'Course picker uses the 104 pool courses');
    check(await poolPicker.getByRole('searchbox').evaluate(el => el === document.activeElement), 'Course picker focuses its search');
    await poolPicker.getByRole('searchbox').fill('Hanshin 3200');
    await shot(page, `stamina-course-picker-${width}x${height}`);
    await page.keyboard.press('Escape');
    check(await page.getByRole('button', { name: 'Choose the course', exact: true }).evaluate(el => el === document.activeElement), 'Course picker Escape restores row focus');
    await page.getByRole('button', { name: 'Choose the course', exact: true }).click();
    await poolPicker.getByRole('searchbox').fill('Hanshin 3200');
    await poolPicker.getByRole('button', { name: 'Hanshin 3200 · Turf · Outer to Inner', exact: true }).click();
    check(await page.getByRole('button', { name: 'Run 1 races', exact: true }).isEnabled(), 'Explicit choice enables the partial batch');
    await page.getByRole('button', { name: 'Run 1 races', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.draft-races > div > button:enabled').length === 1);
    const mappedInput = await page.evaluate(() => window.__SHOT_CONTROL__.calls.filter(c => c.command === 'stamina_check_races').at(-1).args.input.races[0]);
    check(mappedInput.map_id === 'hanshin-3200-turf-outer-to-inner' && mappedInput.ground_condition === 1 && mappedInput.weather === 1 && mappedInput.season === 1, 'Manual course uses the draft conditions');
    await page.evaluate(async message => { message.roomCode = 'XYZ789'; message.event.matchId = 'XYZ789'; message.event.version = 1003; await window.__SHOT_CONTROL__.emit('feed-message', message); }, unknownMessage);
    await page.getByText('Unknown course', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Choose the course', exact: true }).isEnabled(), 'A previous room’s results do not hide the new room’s unknown course');
    await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('shots:stamina.json:last-inputs-v1'))?.courseChoices?.ABC123 ?? {}).length === 1);
    await page.reload();
    await page.locator('.feed-status b').filter({ hasText: 'CAS7R1' }).waitFor();
    check(await page.locator('.build-drawer').count() === 0, 'Closed dock persists across reload');
    await page.evaluate(async message => { await window.__SHOT_CONTROL__.emit('feed-message', message); }, unknownMessage);
    await page.getByRole('group', { name: 'Course mode', exact: true }).getByRole('button', { name: 'Draft', exact: true }).click();
    check(await page.getByRole('button', { name: 'Run 1 races', exact: true }).isEnabled(), 'Course choice persists for the same match');
    await page.evaluate(async message => { message.roomCode = 'XYZ789'; message.event.matchId = 'XYZ789'; message.event.version = 1003; await window.__SHOT_CONTROL__.emit('feed-message', message); }, unknownMessage);
    await page.getByText('Unknown course', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Run 0 races', exact: true }).isDisabled(), 'Course choice never leaks to another match');
    await page.evaluate(async () => { const c = window.__SHOT_CONTROL__; await c.emit('feed-message', c.draftMessage(false, 1003)); });
    await page.getByText('7 of 7 races known', { exact: true }).waitFor();
    check(await page.locator('.draft-races > div > button:enabled').count() === 0, 'Feed changes do not auto-run');
    await page.getByRole('button', { name: /^Run (check|\d+ races)$/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.draft-races > div > button:enabled').length === 7);
    await page.getByRole('button', { name: 'Edit build', exact: true }).click();
    await shot(page, 'stamina-draft-results-' + width + 'x' + height);
    await page.locator('.draft-races > div > button').nth(4).click();
    await page.locator('.stamina-chart').waitFor();
    await shot(page, 'stamina-race-detail-' + width + 'x' + height);
    await page.getByRole('button', { name: '← Back to draft races', exact: true }).click();
    await page.evaluate(async () => { const c = window.__SHOT_CONTROL__, message = c.draftMessage(false, 1004); message.event.state.team1.pickedMaps[0].conditions.ground = 'Heavy'; await c.emit('feed-message', message); });
    await page.getByText('Draft changed since this run', { exact: true }).waitFor();
    await page.evaluate(() => { window.__SHOT_CONTROL__.slow = true; });
    await page.getByRole('button', { name: /^Run (check|\d+ races)$/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.draft-races > div > button:enabled').length === 2);
    await page.evaluate(async () => { const c = window.__SHOT_CONTROL__, request_id = c.calls.filter(c => c.command === 'stamina_check_races').at(-1).args.input.request_id; await c.emit('stamina-progress', { request_id, race_index: 2, race_total: 7, stage: 'refining', percent: 38 }); await c.emit('stamina-progress', { request_id, race_index: 1, race_total: 7, stage: 'mapping', percent: 20 }); });
    await page.getByText('Race 3 of 7 · Refining thresholds', { exact: true }).waitFor();
    check(await page.getByRole('progressbar').getAttribute('value') === '38', 'Batch progress moves only forward');
    await shot(page, 'stamina-draft-progress-' + width + 'x' + height);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: /^Run (check|\d+ races)$/ }).waitFor({ state: 'visible' });
    check(await page.locator('.draft-races > div > button:enabled').count() === 2, 'Cancel keeps finished races');
    await shot(page, `stamina-draft-cancelled-${width}x${height}`);
    await page.getByRole('group', { name: 'Course mode', exact: true }).getByRole('button', { name: 'Any course', exact: true }).click();
    check((await page.getByRole('button', { name: 'Race', exact: true }).innerText()).includes('Hanshin 3200'), 'Draft never overwrites any-course race');
    await page.getByRole('button', { name: 'Race settings', exact: true }).click();
    check(await page.getByRole('group', { name: 'Target', exact: true }).getByRole('button', { name: '95%', exact: true }).getAttribute('aria-pressed') === 'true', 'Target remembered independently');
    }
    await page.close();
  }
  if (!arenaOnly && !statesOnly && !dataOnly && !usabilityOnly) {
  for (const [width, height] of [[1000, 700], [1280, 800]]) {
  const empty = await open('empty', width, height);
  await empty.getByRole('button', { name: 'Stamina', exact: true }).click();
  await empty.getByRole('group', { name: 'Course mode' }).getByRole('button', { name: 'Draft', exact: true }).click();
  await empty.getByRole('heading', { name: 'No draft available' }).waitFor();
  await shot(empty, `stamina-no-draft-${width}x${height}`);
  await empty.close();
  const engineError = await open('lobby', width, height);
  await engineError.getByRole('button', { name: 'Stamina', exact: true }).click();
  await engineError.evaluate(() => { window.__SHOT_CONTROL__.failNext = true; });
  await engineError.getByRole('button', { name: 'Run check', exact: true }).click();
  await engineError.getByText('Engine error', { exact: true }).waitFor();
  await shot(engineError, `stamina-engine-error-${width}x${height}`);
  await engineError.getByRole('button', { name: 'Edit build', exact: true }).click();
  await engineError.waitForFunction(() => JSON.parse(localStorage.getItem('shots:stamina.json:last-inputs-v1'))?.buildOpen === true);
  await engineError.reload();
  await engineError.getByRole('complementary', { name: 'Build editor' }).waitFor();
  check(await engineError.getByRole('button', { name: 'Edit build', exact: true }).getAttribute('aria-expanded') === 'true', 'Open dock persists across reload');
  await engineError.getByRole('spinbutton', { name: 'Speed', exact: true }).focus();
  check(await engineError.getByRole('spinbutton', { name: 'Speed', exact: true }).evaluate(el => getComputedStyle(el).outlineStyle !== 'none'), 'Stamina input keyboard focus is visible');
  await engineError.close();
  const noData = await open('stamina-no-data', width, height);
  await noData.getByRole('button', { name: 'Stamina', exact: true }).click();
  await noData.getByRole('button', { name: 'Edit build', exact: true }).click();
  check(await noData.getByText('Local skill data unavailable.', { exact: false }).count() === 1, 'Missing-data notice appears once, quietly');
  await noData.getByRole('button', { name: '+ Add skill', exact: true }).first().click();
  await noData.getByRole('combobox', { name: 'Search skills', exact: true }).fill('Straightaways ◎');
  check(await noData.getByRole('listbox', { name: 'Matching skills' }).getByRole('option').count() === 1, 'Fallback engine catalog remains usable without region metadata');
  check(await noData.locator('.skill-options img').count() === 0, 'No icons requested without local data');
  await shot(noData, `stamina-no-data-${width}x${height}`);
  await noData.close();
  }
  }
  if (!staminaOnly && !statesOnly && !usabilityOnly) {
  for (const [width, height] of [[1000, 700], [1280, 800]]) {
    const privatePlayer = await open('private', width, height);
    await privatePlayer.locator('.arena-card[data-state="private"]').waitFor();
    await privatePlayer.getByRole('button', { name: 'Open details for Replay Player 2', exact: true }).click();
    await privatePlayer.locator('.drawer-history .recent-match-code').first().waitFor();
    check((await privatePlayer.locator('.drawer-stat-strip b').allTextContents()).every(value => value === '-'), 'Private drawer never derives stats from visible history');
    check(await privatePlayer.locator('[aria-label="Player Uma stats"] tbody tr').count() === 0 && await privatePlayer.locator('.drawer-badges > span').count() === 0, 'Private history never creates Uma stats or badges');
    await privatePlayer.locator('.arena-player-drawer [tabindex="0"]').first().focus();
    await privatePlayer.keyboard.press('Shift+Tab');
    check(await privatePlayer.getByRole('button', { name: 'Next page', exact: true }).evaluate(el => el === document.activeElement), 'Drawer traps reverse keyboard focus');
    await privatePlayer.keyboard.press('Tab');
    check(await privatePlayer.locator('.arena-player-drawer [tabindex="0"]').first().evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== 'none'), 'Drawer close focus is visible and trapped');
    await shot(privatePlayer, `drawer-private-${width}x${height}`);
    await privatePlayer.locator('.recent-match-code').first().click();
    await privatePlayer.locator('.match-code').waitFor();
    check(await privatePlayer.locator('.arena-player-drawer').count() === 0, 'A drawer match code opens History and closes the drawer');
    await privatePlayer.getByRole('button', { name: '← Matches', exact: true }).click();
    const stored = await privatePlayer.evaluate(() => JSON.parse(localStorage.getItem('shots:history.json:recent-matches-v1')));
    check(stored.length === 1 && Object.keys(stored[0]).sort().join(',') === 'code,label', 'Recently opened stores only codes and labels');
    await privatePlayer.close();
    const noData = await open('stamina-no-data', width, height);
    await noData.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
    await noData.getByText('Not found', { exact: true }).waitFor();
    check((await noData.locator('#settings-data').innerText()).includes('0 skills · 0 icons'), 'Settings reports missing local files without fabricated counts');
    await shot(noData, `settings-no-data-${width}x${height}`);
    await noData.close();
  }
  const compact = await open('lobby', 440, 860);
  check((await compact.locator('.team-heading .num').first().innerText()).replaceAll(',', '').includes('1688'), 'Compact and shared cards use the same conservative team rating');
  await shot(compact, 'compact-lobby-440x860');
  await compact.getByRole('button', { name: 'Open details for Replay Player 1', exact: true }).click();
  await compact.getByText('Replay Champion', { exact: true }).waitFor();
  check(await compact.locator('.player-drawer .iconbtn').evaluate(button => button.getBoundingClientRect().width === 40), 'Compact drawer close button uses shared styling');
  await compact.locator('.drawer-history .recent-match-code').first().waitFor();
  check(await compact.locator('.player-drawer').evaluate(element => element.getBoundingClientRect().width === innerWidth), 'Compact drawer is full width');
  await shot(compact, 'compact-drawer-440x860');
  await compact.keyboard.press('Escape');
  await nav(compact, 'Draft');
  await shot(compact, 'compact-draft-440x860');
  check((await compact.locator('.turn-banner').innerText()).includes('Uma pick 4 of 5'), 'Turn derived from state');
  check(await compact.locator('.slot.now').count() === 1, 'Current slot highlighted');
  check(await compact.locator('.compact-stamina-strip').count() === 0, 'No compact stamina strip before a run');
  await compact.evaluate(async () => {
    const c = window.__SHOT_CONTROL__, message = structuredClone(c.messages.at(-1));
    message.event.version = 1000;
    const s = message.event.state;
    s.draftActionHistory = [...s.team2.pickedUmas.map(uma => ({ action: 'uma-pick', actorTeam: 'team2', uma })), ...s.team1.pickedUmas.map(uma => ({ action: 'uma-pick', actorTeam: 'team1', uma }))];
    await c.emit('feed-message', message);
  });
  await compact.locator('.arena-pick-order').waitFor();
  await shot(compact, 'compact-pick-order-440x860');
  await compact.getByRole('button', { name: 'Expand to full mode' }).click();
  await compact.locator('.sidebar').getByRole('button', { name: 'Stamina', exact: true }).click();
  await compact.evaluate(async () => { const c = window.__SHOT_CONTROL__; await c.emit('feed-message', c.draftMessage(true)); });
  await compact.getByRole('group', { name: 'Course mode' }).getByRole('button', { name: 'Draft', exact: true }).click();
  await compact.getByRole('button', { name: /^Run \d+ races$/ }).click();
  await compact.waitForFunction(() => document.querySelectorAll('.draft-races > div > button:enabled').length === 1);
  await nav(compact, 'Draft');
  await compact.getByRole('button', { name: 'Compact', exact: true }).click();
  await compact.getByRole('button', { name: 'Open stamina for draft races' }).waitFor();
  check(await compact.locator('.stamina-pips > span').count() === 7 && await compact.locator('.stamina-pips .pending').count() === 6, 'Partial runs keep seven compact slots with pending races');
  await shot(compact, 'compact-stamina-partial-440x860');
  await compact.getByRole('button', { name: 'Open stamina for draft races' }).click();
  await compact.evaluate(async () => { const c = window.__SHOT_CONTROL__; await c.emit('feed-message', c.draftMessage(false, 1002)); });
  await compact.getByText('7 of 7 races known', { exact: true }).waitFor();
  await compact.getByRole('button', { name: 'Run 7 races', exact: true }).click();
  await compact.waitForFunction(() => document.querySelectorAll('.draft-races > div > button:enabled').length === 7);
  const runCalls = await compact.evaluate(() => window.__SHOT_CONTROL__.calls.filter(c => c.command === 'stamina_check_races').length);
  await nav(compact, 'Draft');
  await compact.getByRole('button', { name: 'Compact', exact: true }).click();
  await compact.getByRole('button', { name: 'Open stamina for draft races' }).waitFor();
  check(await compact.locator('.stamina-pips > span').count() === 7, 'Compact stamina strip shares seven race results');
  await shot(compact, 'compact-stamina-strip-440x860');
  await compact.getByRole('button', { name: 'Open stamina for draft races' }).click();
  check(await compact.getByRole('group', { name: 'Course mode' }).getByRole('button', { name: 'Draft', exact: true }).getAttribute('aria-pressed') === 'true', 'Strip expands directly to draft stamina');
  check(await compact.evaluate(() => window.__SHOT_CONTROL__.calls.filter(c => c.command === 'stamina_check_races').length) === runCalls, 'Switching modes never reruns stamina');
  await nav(compact, 'Draft');
  await compact.getByRole('button', { name: 'Compact', exact: true }).click();
  await compact.evaluate(async () => { const c = window.__SHOT_CONTROL__, m = c.draftMessage(false, 1002); m.roomCode = 'XYZ789'; m.event.matchId = 'XYZ789'; await c.emit('feed-message', m); });
  check(await compact.locator('.compact-stamina-strip').count() === 0, 'Draft runs never leak to another match');
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
  if (!staminaOnly && !dataOnly && !usabilityOnly) {
    for (const [width, height] of [[1000, 700], [1280, 800]]) {
      const page = await open('lobby', width, height);
      for (const name of ['Stamina', 'Settings']) {
        await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
        await shot(page, `shell-${name.toLowerCase()}-${width}x${height}`);
      }
      await nav(page, 'Draft');
      check(await page.locator('.arena-pick-order').count() === 0, 'No strip without real snapshot history');
      for (const [index, phase] of ['map-pick', 'uma-pick', 'complete'].entries()) {
        await page.evaluate(async ({ index, phase }) => {
          const c = window.__SHOT_CONTROL__, message = structuredClone(c.messages.at(-1));
          message.event.version = 2000 + index;
          const state = message.event.state; state.phase = phase;
          if (phase === 'map-pick') { state.team1.pickedUmas = []; state.team2.pickedUmas = []; state.team1.pickedMaps = state.team1.pickedMaps.slice(0, 1); state.team2.pickedMaps = []; delete state.wildcardMap; }
          if (phase === 'complete') for (const side of [state.team1, state.team2]) while (side.pickedUmas.length < 5) side.pickedUmas.push({ id: String(100101 + side.pickedUmas.length * 100) });
          if (phase !== 'map-pick') {
            state.team1.bannedUmas = [{ id: '100701' }];
            const all = [...state.team2.pickedUmas.map(uma => ({ action: 'uma-pick', actorTeam: 'team2', uma })), ...[...state.team1.pickedUmas, ...state.team1.bannedUmas].map(uma => ({ action: 'uma-pick', actorTeam: 'team1', uma }))];
            state.draftActionHistory = all;
          }
          await c.emit('feed-message', message);
        }, { index, phase });
        if (phase !== 'map-pick') {
          await page.locator('.arena-pick-order').waitFor();
          check(await page.locator('.arena-pick-order li').first().getAttribute('class') === 'team-2', 'Pick strip follows explicit history instead of assumed alternating order');
          check((await page.locator('.arena-draft-team').first().innerText()).includes('Gold Ship'), 'Veto remains in the original picking team’s slot');
        }
        await shot(page, `draft-${phase}-${width}x${height}`);
        if (phase === 'complete') check(await page.locator('.arena-race:not(.pending)').count() === 7, 'Finished draft shows seven races and conditions');
      }
      await page.evaluate(async () => { const c = window.__SHOT_CONTROL__; await c.emit('feed-message', { v: 1, type: 'left' }); await c.emit('feed-status', { state: 'disconnected', accepted: 12, rejected: 0 }); });
      await page.locator('.reconnect').waitFor();
      check(await page.locator('.dimmed .arena-draft-team').count() === 2, 'Native disconnect sequence retains last draft');
      await shot(page, `draft-disconnected-${width}x${height}`);
      await nav(page, 'Lobby');
      check(await page.locator('.dimmed .arena-card').count() === 10, 'Native disconnect sequence retains last roster');
      check((await page.locator('.arena-stats').first().innerText()).includes('212-119'), 'Disconnect retains loaded stats');
      await shot(page, `lobby-disconnected-${width}x${height}`);
      await page.close();
      for (const scene of ['empty', 'loading', 'profile-error', 'private', 'port-in-use', 'draft-loading', 'feed-error']) {
        const state = await open(scene, width, height);
        if (scene === 'loading') {
          try { await state.locator('.arena-loading').first().waitFor(); }
          catch (error) { console.error(await state.locator('body').innerText()); console.error(await state.evaluate(() => window.__SHOT_CONTROL__.calls.filter(c => c.command === 'plugin:http|fetch').map(c => c.args.clientConfig.url))); throw error; }
        }
        if (scene === 'profile-error') await state.locator('.feed-banner.error').waitFor();
        if (scene === 'private') await state.locator('.arena-card[data-state="private"]').waitFor();
        await shot(state, `lobby-${scene}-${width}x${height}`);
        await nav(state, 'Draft');
        if (scene === 'draft-loading') await state.locator('.draft-loading').waitFor();
        await shot(state, `draft-${scene}-${width}x${height}`);
        if (scene === 'port-in-use') {
          await state.context().grantPermissions(['clipboard-read', 'clipboard-write']);
          await state.getByRole('button', { name: 'Copy diagnostics', exact: true }).click();
          await state.getByText('Diagnostics copied', { exact: true }).waitFor();
          const diagnostic = await state.evaluate(() => navigator.clipboard.readText());
          check(!/100000000000000|CAS7R1|token|discord/i.test(diagnostic), 'Copied diagnostics contain no room codes, IDs or tokens');
          await state.getByRole('button', { name: 'Retry', exact: true }).click();
          check(await state.evaluate(() => window.__SHOT_CONTROL__.calls.filter(c => c.command === 'start_feed').length) === 2, 'Port conflict Retry invokes the existing listener command');
        }
        await state.close();
      }
    }
    for (const [width, columns] of [[1000, 5], [900, 4], [780, 3], [640, 2], [600, 2]]) {
      const page = await open('lobby', width, 700);
      check(await page.locator('.arena-player-grid').first().evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length) === columns, `Lobby ${columns} columns at ${width}px`);
      check(await page.locator('.arena-card').evaluateAll(cards => new Set(cards.map(card => Math.round(card.getBoundingClientRect().height))).size) === 1, 'Lobby cards have equal heights');
      check((await page.locator('.arena-stats').first().innerText()).includes('212-119'), 'Triple-digit records fit the four-stat row');
      await shot(page, `lobby-${columns}columns-${width}x700`);
      await nav(page, 'Draft');
      await shot(page, `draft-resize-${width}x700`);
      if (width === 600) { await page.setViewportSize({ width: 599, height: 700 }); await page.locator('.compact-header').waitFor(); check(await page.locator('.sidebar').count() === 0, '600px preference switches compact below threshold'); }
      await page.close();
    }
    const focus = await open('lobby', 1000, 700);
    await focus.keyboard.press('Tab');
    await focus.locator('.arena-card-hit').first().focus();
    check(await focus.locator('.arena-card-hit').first().evaluate(button => getComputedStyle(button).outlineStyle !== 'none'), 'Keyboard focus is visible');
    await shot(focus, 'lobby-keyboard-focus-1000x700');
    await focus.close();
  }
  if (!staminaOnly && !arenaOnly && !statesOnly && !dataOnly) await (await import('./shots-usability.mjs')).runUsabilityShots({ open, nav, shot, check });
  check(failures.length === 0, failures.join('\n'));
  console.log(`${checks} checks passed; screenshots: ${out}`);
} finally { await browser?.close(); await server.close(); }
