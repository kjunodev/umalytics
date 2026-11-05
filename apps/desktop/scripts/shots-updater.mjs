import assert from 'node:assert/strict';

export async function runUpdateShots({ open, nav, shot, check }) {
  for (const width of [1000, 440]) {
    const page = await open('updates', width, 860, { compactThreshold: 440, automaticUpdates: false });
    await nav(page, 'Settings');
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await page.getByText('UmaLytics 0.2.0 is downloading…', { exact: true }).waitFor();
    await nav(page, 'Lobby');
    if (width === 440) await page.getByRole('button', { name: 'Compact', exact: true }).click();
    const top = await page.locator('main').evaluate(element => element.getBoundingClientRect().top);
    await shot(page, `update-downloading-${width}`);
    await page.evaluate(async () => {
      const c = window.__SHOT_CONTROL__;
      await c.emit('feed-message', { v: 1, type: 'left' });
      await c.emit('feed-status', { state: 'listening', accepted: 10, rejected: 0 });
      c.finishUpdateDownload();
    });
    await page.getByRole('button', { name: 'Update and restart', exact: true }).waitFor();
    check(await page.locator('main').evaluate(element => element.getBoundingClientRect().top) === top, 'Update banner causes no layout shift');
    await shot(page, `update-ready-${width}`);
    await page.getByRole('button', { name: "What's new", exact: true }).click();
    await page.getByRole('region', { name: "What's new" }).getByText('Fixture release notes: bundled data and signed updates.', { exact: true }).waitFor();
    await shot(page, `update-notes-${width}`);
    await page.getByRole('region', { name: "What's new" }).getByRole('button', { name: 'Close' }).click();
    await page.evaluate(async () => { const c = window.__SHOT_CONTROL__; for (const message of c.messages) await c.emit('feed-message', message); await c.emit('feed-status', { state: 'connected', accepted: 10, rejected: 0 }); });
    await page.getByText('Update ready · it will install after your room', { exact: true }).waitFor();
    await shot(page, `update-room-${width}`);
    await page.getByRole('button', { name: 'Dismiss update', exact: true }).click();
    assert.equal(await page.getByRole('complementary', { name: 'App update' }).count(), 0);
    await page.close();

    const failed = await open('updates', width, 860, { compactThreshold: 440, automaticUpdates: false });
    await nav(failed, 'Settings');
    await failed.evaluate(() => { window.__SHOT_CONTROL__.failUpdate = true; });
    await failed.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await failed.getByText('Update failed', { exact: true }).waitFor();
    await failed.locator('#settings-about').scrollIntoViewIfNeeded();
    await shot(failed, `settings-about-updates-${width}`);
    check(await failed.getByText('Race engine: uma-race-simulator (MIT)', { exact: true }).isVisible(), 'About credits the race engine');
    await nav(failed, 'Lobby');
    if (width === 440) await failed.getByRole('button', { name: 'Compact', exact: true }).click();
    await shot(failed, `update-error-${width}`);
    await failed.getByRole('button', { name: 'Retry', exact: true }).click();
    await failed.getByText('UmaLytics 0.2.0 is downloading…', { exact: true }).waitFor();
    await failed.close();
  }
}
