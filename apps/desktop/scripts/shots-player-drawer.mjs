export async function runPlayerDrawerShots({ open, nav, shot, check }) {
  const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
  const stats = page => page.locator('.drawer-stat-band');
  const historyCalls = page => page.evaluate(() => window.__SHOT_CONTROL__.calls
    .filter(c => c.command === 'plugin:http|fetch' && new URL(c.args.clientConfig.url).pathname.endsWith('/history'))
    .map(c => Number(new URL(c.args.clientConfig.url).searchParams.get('page'))));
  const fits = async (page, label) => {
    check(await page.locator('.arena-drawer-body').evaluate(el => el.scrollHeight <= el.clientHeight + 1), `${label}: panel does not scroll`);
    check(await page.locator('.arena-player-drawer').evaluate(el => el.scrollWidth <= el.clientWidth), `${label}: no horizontal overflow`);
    check(await page.locator('[role=tabpanel]:not([hidden]) tbody tr').count() === 8, `${label}: eight rows are visible`);
    check(await page.locator('[role=tabpanel] tbody tr').evaluateAll(rows => rows.every(row => Math.abs(row.getBoundingClientRect().height - 40) < 1)), `${label}: rows stay 40px`);
  };
  for (const [width, height] of [[1000, 700], [1280, 800], [440, 860]]) {
    const page = await open('profile-drawer', width, height);
    await page.getByRole('button', { name: 'Open details for Replay Player 3 (Discord: replay.racer)', exact: true }).click();
    await page.locator('[aria-label="Player Uma stats"] tbody tr').nth(7).waitFor();
    await tab(page, 'Matches').filter({ hasText: '55' }).waitFor();
    check(await tab(page, 'Umas').getAttribute('aria-selected') === 'true', 'Umas is the public default');
    check((await historyCalls(page)).join(',') === '1', 'Only API page one loads on open');
    check(await page.locator('.drawer-badges > span').evaluateAll(badges => badges.every(b => b.querySelector('svg') && b.querySelector('span')?.textContent && b.title)), 'Every badge has an icon, label and tooltip');
    await fits(page, 'Umas');
    await shot(page, `profile-umas-${width}x${height}`);
    const footerTop = await page.locator('.profile-drawer-footer').evaluate(el => el.getBoundingClientRect().top);
    await page.getByRole('button', { name: 'Next Umas', exact: true }).click();
    check(await page.locator('[aria-label="Player Uma stats"] tbody tr').count() === 3, 'Uma page two has the remaining rows');
    check(await page.locator('.profile-drawer-footer').evaluate(el => el.getBoundingClientRect().top) === footerTop, 'Short Uma page leaves the footer fixed');
    await page.getByRole('button', { name: 'Show all', exact: true }).click();
    check((await page.locator('.uma-section-pager').innerText()).includes('1/2'), 'Show all resets Uma pagination');
    await page.locator('[aria-label="Player Uma stats"] thead').getByRole('button', { name: /^GP/ }).click();
    check(await page.locator('[aria-label="Player Uma stats"] tbody tr').first().locator('td').first().innerText() === '2', 'Sorting includes the hidden low-game Umas');
    await tab(page, 'Umas').focus(); await page.keyboard.press('ArrowRight');
    check(await tab(page, 'Matches').evaluate(el => el === document.activeElement && el.getAttribute('aria-selected') === 'true'), 'Arrow keys select and focus the other tab');
    await page.locator('.drawer-history tbody tr').nth(7).waitFor();
    await fits(page, 'Matches');
    await shot(page, `profile-matches-${width}x${height}`);
    check((await historyCalls(page)).join(',') === '1', 'Switching tabs adds no history requests');
    await page.getByRole('button', { name: 'Page 3', exact: true }).click();
    await page.getByRole('button', { name: 'PD0023', exact: true }).waitFor();
    check((await page.locator('.recent-match-code').allTextContents()).join(',') === Array.from({ length: 8 }, (_, i) => `PD${String(i + 16).padStart(4, '0')}`).join(','), 'UI page three joins API pages one and two in order');
    check((await historyCalls(page)).join(',') === '1,2', 'UI page three loads only the missing API page');
    await shot(page, `profile-page3-${width}x${height}`);
    await page.getByRole('button', { name: 'Page 7', exact: true }).click();
    await page.getByRole('button', { name: 'PD0054', exact: true }).waitFor();
    check(await page.locator('.recent-match-code').count() === 7, 'Final page uses ceil(total / 8)');
    check((await historyCalls(page)).join(',') === '1,2,3', 'Final page loads only API page three');
    check(await page.locator('.profile-drawer-footer').evaluate(el => el.getBoundingClientRect().top) === footerTop, 'Short match page leaves the footer fixed');
    const before = await stats(page).innerText();
    await page.locator('.profile-drawer-tabs-row').getByRole('button', { name: 'All-time', exact: true }).click();
    await tab(page, 'Matches').filter({ hasText: '63' }).waitFor();
    await page.waitForFunction(before => document.querySelector('.drawer-stat-band').innerText !== before && !document.querySelector('.arena-drawer-body [role=status]'), before);
    check(await tab(page, 'Matches').getAttribute('aria-selected') === 'true', 'Matches survives a scope change');
    check(await page.locator('.drawer-fixed-pager [aria-current=page]').innerText() === '1', 'Scope change resets pagination');
    if (width === 1000) {
      await page.evaluate(() => { window.__SHOT_CONTROL__.failNextHistory = true; });
      await page.getByRole('button', { name: 'Page 3', exact: true }).click();
      await page.getByRole('button', { name: 'Retry history', exact: true }).waitFor();
      check(await page.getByRole('alert').isVisible(), 'A failed API page shows the history retry state');
      await page.getByRole('button', { name: 'Retry history', exact: true }).click();
      await page.getByRole('button', { name: 'PD0023', exact: true }).waitFor();
      check(await page.locator('.recent-match-code').count() === 8, 'Retry restores all eight rows across the API boundary');
    }
    await tab(page, 'Umas').click();
    await page.locator('.profile-drawer-tabs-row').getByRole('button', { name: 'Season', exact: true }).click();
    await page.locator('[aria-label="Player Uma stats"] tbody tr').nth(7).waitFor();
    check(await tab(page, 'Umas').getAttribute('aria-selected') === 'true', 'Umas survives a scope change');
    await page.keyboard.press('Escape');
    check(await page.locator('.arena-player-drawer').count() === 0, 'Escape closes the drawer');
    if (width === 1000) {
      await nav(page, 'Players');
      await page.getByRole('button', { name: 'Replay Player 3', exact: true }).click();
      await tab(page, 'Matches').click();
      await page.locator('.profile-drawer-tabs-row').getByRole('button', { name: 'All-time', exact: true }).click();
      await tab(page, 'Matches').filter({ hasText: '63' }).waitFor();
      check(await tab(page, 'Matches').getAttribute('aria-selected') === 'true', 'Players also preserves Matches across scope changes');
    }
    await page.close();
  }
  const unlinked = await open('profile-unlinked', 1000, 700);
  await unlinked.locator('.arena-card-hit').first().click();
  await unlinked.getByText('No linked profile.', { exact: true }).waitFor();
  check((await historyCalls(unlinked)).length === 0, 'An unlinked drawer makes no history requests');
  await tab(unlinked, 'Matches').click();
  check(await unlinked.getByText('No linked profile.', { exact: true }).isVisible(), 'Unlinked state remains visible in both tabs');
  await unlinked.close();
  for (const [width, height] of [[1000, 700], [440, 860]]) {
    const page = await open('profile-worst', width, height);
    await page.locator('.arena-card-hit, .compact-player-row').first().click();
    await page.locator('.drawer-badges > span').nth(5).waitFor();
    await tab(page, 'Matches').filter({ hasText: '55' }).waitFor();
    check((await stats(page).innerText()).includes('212–119') && (await stats(page).innerText()).includes('Unranked'), 'Worst case includes the full record and Unranked');
    check(await page.locator('.drawer-badges > span').count() === 6, 'All six earned badges are visible');
    await fits(page, 'Worst case Umas');
    await shot(page, `profile-worst-${width}x${height}`);
    await tab(page, 'Matches').click();
    await page.locator('.recent-match-code').nth(7).waitFor();
    await fits(page, 'Worst case Matches');
    await shot(page, `profile-worst-matches-${width}x${height}`);
    await page.close();
  }
  const privatePage = await open('private', 1000, 700);
  await privatePage.locator('.arena-card[data-state=private]').waitFor();
  await privatePage.getByRole('button', { name: 'Open details for Replay Player 2', exact: true }).click();
  await privatePage.locator('.recent-match-code').nth(7).waitFor();
  check(await tab(privatePage, 'Matches').getAttribute('aria-selected') === 'true', 'Private player opens on Matches');
  check((await stats(privatePage).locator('b').allTextContents()).every(value => value === '—'), 'Private ranked stats stay hidden');
  check(await privatePage.locator('.drawer-badges > span').count() === 0, 'History earns no private-player badges');
  await shot(privatePage, 'profile-private-1000x700');
  await tab(privatePage, 'Umas').click();
  check(await privatePage.locator('[aria-label="Player Uma stats"] tbody tr').count() === 0, 'Private history creates no Uma stats');
  await tab(privatePage, 'Matches').click();
  await privatePage.getByRole('button', { name: 'ABC123', exact: true }).click();
  await privatePage.locator('.match-code').waitFor();
  check(await privatePage.locator('.arena-player-drawer').count() === 0, 'Match code opens History and closes the drawer');
  await privatePage.getByRole('group', { name: 'Match view' }).getByRole('button', { name: 'Lobby', exact: true }).click();
  await privatePage.locator('.arena-card-hit').nth(2).click();
  await tab(privatePage, 'Matches').click();
  await privatePage.locator('.profile-drawer-tabs-row').getByRole('button', { name: 'All-time', exact: true }).click();
  await privatePage.locator('.recent-match-code').nth(7).waitFor();
  check(await tab(privatePage, 'Matches').getAttribute('aria-selected') === 'true', 'History Lobby also preserves the tab on scope change');
  await privatePage.close();
}
