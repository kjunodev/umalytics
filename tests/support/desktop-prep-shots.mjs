import { quickplayCode } from '../fixtures/quickplay-match.mts';

export async function runDesktopPrepShots({ open, nav, shot, check }) {
  for (const [scene, checked, locked, name] of [
    ['experimental-release', 'false', false, 'off'],
    ['experimental-debug', 'true', true, 'debug-locked'],
  ]) {
    const page = await open(scene, 1280, 800);
    await nav(page, 'Settings');
    await page.getByRole('link', { name: 'Experimental', exact: true }).click();
    const toggle = page.getByRole('switch', { name: 'Screenshot import' });
    await page.locator(`#settings-experimental button[aria-checked="${checked}"]:text-is("${locked ? 'On' : 'Off'}")`).waitFor();
    check(await toggle.isDisabled() === locked, `Settings screenshot import is ${name}`);
    await shot(page, `settings-experimental-${name}-1280x800`);
    await page.close();
  }

  const memory = { view: 'assessment', input: {
    build: { stats: { stamina: 720 }, skills: [{ id: 200501, level: 1 }] },
    screenshotImport: {
      points: 250, observations: [
        { id: 200501, owned: true, level: 1, price: null, hint: null },
        { id: 200542, owned: false, level: null, price: 180, hint: null },
      ], ignored: [], selected: [],
    },
  } };
  const page = await open('experimental-scan', 1280, 800, {}, memory);
  const importAction = page.getByRole('button', { name: 'Import from screenshots' });
  const shop = page.getByRole('region', { name: 'Skill shop' });
  const stamina = page.getByRole('spinbutton', { name: 'Stamina', exact: true });
  const toggle = page.getByRole('switch', { name: 'Screenshot import' });
  await nav(page, 'Stamina');
  await importAction.waitFor();
  await shop.waitFor();
  await nav(page, 'Settings');
  await toggle.click();
  await page.locator('#settings-experimental button[aria-checked="false"]:text-is("Off")').waitFor();
  await nav(page, 'Stamina');
  await importAction.waitFor({ state: 'hidden' });
  check(await shop.count() === 0, 'Disabling screenshot import hides the loaded shop');
  check(await stamina.inputValue() === '720', 'Disabling screenshot import keeps the loaded build');
  await page.waitForFunction(() => {
    const { build, screenshotImport } = JSON.parse(localStorage.getItem('shots:stamina.json:last-inputs-v1')).input;
    return build.skills.some(skill => skill.id === 200501) && screenshotImport?.points === 250;
  });
  await nav(page, 'Settings');
  await toggle.click();
  await page.locator('#settings-experimental button[aria-checked="true"]:text-is("On")').waitFor();
  await nav(page, 'Stamina');
  await importAction.waitFor();
  await shop.waitFor();
  check(await stamina.inputValue() === '720', 'Re-enabling screenshot import restores the shop without restarting');
  await page.close();

  for (const width of [1280, 1000, 440]) {
    const draftPage = await open('quickplay', width, 800);
    await nav(draftPage, 'Draft');
    await draftPage.locator('.turn-banner .format-chip:text-is("Quickplay")').waitFor();
    const assertDraft = async () => {
      check(await draftPage.locator('.arena-race:not(.pending)').count() === 7, 'Quickplay has six races and the tiebreaker');
      check(await draftPage.locator('.arena-draft-team .slot.filled').count() === 10, 'Quickplay shows five picks per team');
      check(await draftPage.locator('.arena-draft-team .slot.ban').count() === 6, 'Quickplay shows three pre-bans per team');
      check(await draftPage.locator('.arena-draft-team .slot.empty, .vetoed-maps').count() === 0 &&
        await draftPage.getByRole('heading', { name: 'Veto', exact: true }).count() === 0, 'Quickplay omits unused slots');
    };
    await assertDraft();
    await shot(draftPage, `quickplay-draft-${width}x800`);
    if (width > 440) {
      await nav(draftPage, 'History');
      await draftPage.getByRole('textbox', { name: 'Match code or URL' }).fill(quickplayCode);
      await draftPage.getByRole('button', { name: 'Load', exact: true }).click();
      await draftPage.locator('.match-heading .format-chip:text-is("Quickplay")').waitFor();
      await assertDraft();
      await shot(draftPage, `quickplay-history-${width}x800`);
    }
    await draftPage.close();
  }
}
