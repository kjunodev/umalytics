export async function quickplayLayoutFailures(page) {
  const failures = [];
  if (await page.locator('.draft-format:text-is("Quickplay")').count() !== 1) failures.push('Quickplay chip is missing');
  if (await page.locator('.draft-pick-tile button').count() !== 10) failures.push('Quickplay needs five picks per team');
  if (await page.locator('.draft-ban-veto-row').count() !== 6) failures.push('Quickplay needs three pre-bans per team');
  if (await page.locator('.draft-pick-tile.placeholder, .draft-ban-veto-slot.empty, .draft-vetoed-map-row').count()) failures.push('Quickplay has unused draft slots');
  if (await page.locator('.draft-race-card:not(.placeholder)').count() !== 7) failures.push('Quickplay needs six races and the tiebreaker');
  if (await page.locator('.draft-stage').count()) failures.push('Quickplay shows a veto-stage track');
  return failures;
}
