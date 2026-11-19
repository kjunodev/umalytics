export async function runPlatformShots({ open, nav, shot, check }) {
  for (const [width, height] of [[1280, 800], [1000, 700]]) {
    for (const uiSize of ['Small', 'Default', 'Large']) {
      const page = await open('unsupported-platform', width, height, { uiSize });
      const suffix = `${uiSize.toLowerCase()}-${width}x${height}`;
      for (const scene of ['Lobby', 'Draft', 'Umas', 'Players', 'History', 'Settings', 'Stamina']) {
        await nav(page, scene);
        if (scene === 'Players') await page.locator('.table-player').first().waitFor();
        if (scene === 'Umas') await page.locator('.arena-uma-catalog button').first().waitFor();
        if (scene === 'Settings') {
          await page.getByText('Found', { exact: true }).waitFor();
          check(await page.locator('#settings-experimental').count() === 0, 'Unsupported platform hides Experimental settings');
          check(await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Experimental' }).count() === 0, 'Unsupported platform hides Experimental navigation');
        }
        if (scene === 'Stamina') {
          await page.locator('.stamina-uma-trigger').waitFor();
          check(await page.getByRole('button', { name: 'Import from screenshots' }).count() === 0, 'Unsupported platform has no screenshot import');
        }
        // Root zoom should fill one viewport exactly, rather than scaling twice.
        const bounds = await page.locator('.desktop-shell').boundingBox();
        check(Math.abs(bounds.height - height) < 2 && Math.abs(bounds.width - width) < 2, `${scene} ${suffix}: zoom fills the viewport`);
        await shot(page, `platform-${scene.toLowerCase()}-${suffix}`);
      }
      const raceTab = page.getByRole('tab', { name: 'Race', exact: true });
      await raceTab.click();
      check(await raceTab.evaluate(element => element === document.activeElement), 'Selecting a build tab focuses it in WebKit');
      await page.getByRole('tab', { name: 'Build', exact: true }).click();
      await page.locator('.stamina-uma-trigger').click();
      await page.getByRole('dialog', { name: 'Choose Uma' }).waitFor();
      await shot(page, `platform-uma-dialog-${suffix}`);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Choose Uma' }).waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Race', exact: true }).click();
      await shot(page, `platform-race-popover-${suffix}`);
      await page.keyboard.press('Escape');
      await nav(page, 'Lobby');
      const player = page.getByRole('button', { name: 'Open details for Replay Player 1', exact: true });
      await player.click();
      await page.getByText('Replay Champion', { exact: true }).waitFor();
      await shot(page, `platform-player-dialog-${suffix}`);
      await page.keyboard.press('Escape');
      check(await player.evaluate(element => element === document.activeElement), 'Closing player details restores focus to the card in WebKit');
      await page.close();
    }
  }
}
