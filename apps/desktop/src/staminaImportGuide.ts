import type { Screenshot } from './staminaScreenshot';

export const importGuide = {
  career: {
    label: 'Before buying skills',
    steps: [
      'In the game, on Complete Career, click **Skills** to open the **Learn** screen.',
      'Click **Full Stats**, then the **Skills** tab. Here, click **Capture game window** (or press Ctrl+Shift+U). Then click **Close** in the game.',
      'Click **Start scanning**. In the game, scroll the skill list from top to bottom, pausing about a second whenever new skills come into view.',
      'At the bottom of the list, click **Apply to build**. It stops the scan for you.',
    ],
  },
  finished: {
    label: 'A finished Uma',
    steps: [
      "Open the Uma's **Umamusume Details** from your Veteran List and click the **Skills** tab.",
      'Click **Start scanning** and scroll the skill list to the end.',
      'Click **Apply to build**.',
    ],
  },
} as const;

export type ImportGuide = keyof typeof importGuide;

export function importGuideProgress(guide: ImportGuide, screens: Screenshot[]): boolean[] {
  if (guide === 'finished') {
    const details = screens.filter(scan => scan.screen === 'finished-details');
    return [details.length > 0, details.some(scan => scan.skills.length > 0), false];
  }
  const learn = screens.filter(scan => scan.screen === 'learn');
  const fullStats = screens.some(scan => scan.screen === 'details-skills' || scan.screen === 'details-conditions');
  const legacyStats = screens.some(scan => scan.screen === 'attributes-numbers' && !!scan.attributes);
  return [learn.length > 0 || fullStats, fullStats || legacyStats, learn.some(scan => scan.skills.length > 0), false];
}

export function importApplyLabel(finished: boolean, stats: boolean, skills: number, finishing?: number): string {
  if (finishing !== undefined) return finishing === 0 ? 'Finishing…' : `Finishing ${finishing} ${finishing === 1 ? 'view' : 'views'}…`;
  if (finished) return 'Apply build';
  if (!stats) return 'Apply to build';
  return skills ? `Apply ${skills} ${skills === 1 ? 'skill' : 'skills'} and stats` : 'Apply stats';
}
