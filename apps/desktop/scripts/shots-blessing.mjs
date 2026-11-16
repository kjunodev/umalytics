import { season3RoomState } from '../../../tests/fixtures/season3-matches.mjs';
import { season3Codes } from './shots-fixture.mjs';

// Season 3 scenes: the goddess chip, the Byerley Turk candidates, the Darley
// Arabian limit, running styles and the History header, at 125% scaling.
const expected = {
  'godolphin-barb': 'Godolphin Barb · Sunny / Firm',
  'darley-arabian': 'Darley Arabian · Long limit 3',
  'byerley-turk': 'Byerley Turk · sealed tiebreaker bans'
};
const clean = text => text.replace(/\s+/g, ' ').trim();

export async function runBlessingShots({ open, nav, shot, check }) {
  for (const [width, height] of [[1280, 800], [1000, 700], [440, 860]]) {
    for (const goddess of Object.keys(expected)) {
      const page = await open('blessing', width, height);
      await nav(page, 'Draft');
      await page.evaluate(async ({ state }) => {
        const c = window.__SHOT_CONTROL__, message = structuredClone(c.messages.at(-1));
        message.event.version = 5000;
        message.event.state = { ...state, multiplayer: { ...state.multiplayer, rankedQueueRoster: message.event.state.multiplayer.rankedQueueRoster } };
        await c.emit('feed-message', message);
      }, { state: season3RoomState(goddess) });
      await page.locator('.blessing-chip').waitFor();
      check(clean(await page.locator('.turn-banner .blessing-chip').innerText()) === expected[goddess], `Draft chip names ${goddess}`);
      check(JSON.stringify((await page.locator('.style-mix').allInnerTexts()).map(clean)) === JSON.stringify(['Front · 3 Pace · End', 'Runaway · Front · 2 Pace · End']), 'Each team shows its running-style mix');
      check(await page.locator('.slot.filled .style-tag').count() === 10, 'Five assigned picks per team carry a style tag');
      check((await page.locator('.map-limits').innerText()).includes(goddess === 'darley-arabian' ? '2 per distance (Long 3)' : '2 per distance'), 'Races panel shows the map limits');
      check((await page.locator('.map-limits').innerText()).includes('Dirt 3 per team'), 'Dirt limit is 3');
      check(await page.locator('.arena-candidates .arena-candidate').count() === (goddess === 'byerley-turk' ? 3 : 0), 'Only Byerley Turk lists tiebreaker candidates');
      if (goddess === 'byerley-turk') {
        check(await page.locator('.candidate-tag.selected').count() === 1 && await page.locator('.arena-candidate.selected').count() === 1, 'One candidate is the tiebreaker');
        check(await page.locator('.arena-candidate.banned .candidate-tag:not(.selected)').count() === 2, 'Both teams’ sealed bans are shown');
      }
      await shot(page, `blessing-draft-${goddess}-${width}x${height}`);
      if (width === 440) { await page.close(); continue; }
      await page.getByRole('button', { name: 'History', exact: true }).click();
      const code = Object.keys(season3Codes).find(key => season3Codes[key] === goddess);
      await page.getByRole('textbox', { name: 'Match code or URL' }).fill(code);
      await page.getByRole('button', { name: 'Load', exact: true }).click();
      await page.locator('[aria-label="History"] .draft-scene').waitFor();
      check(clean(await page.locator('.match-heading .blessing-chip').innerText()) === expected[goddess], `History header names ${goddess}`);
      check(await page.locator('[aria-label="History"] .arena-race:not(.pending)').count() === 7, 'History displays the six saved races and the tiebreaker');
      check(await page.locator('[aria-label="History"] .slot.filled .style-tag').count() === 10, 'History shows the saved running styles');
      await shot(page, `blessing-history-${goddess}-${width}x${height}`);
      await page.close();
    }
  }
}
