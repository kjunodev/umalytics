import type { PrematchPlayer } from '@umalytics/shared';

export interface PartyVisual {
  className: 'party-accent-1' | 'party-accent-2';
  label: string;
  title: string;
}

export function getTeamPartyVisuals(players: PrematchPlayer[]): Record<string, PartyVisual> {
  const partyCounts = new Map<string, number>();
  const orderedPartyIds: string[] = [];

  for (const player of players) {
    if (player.partyId === null || player.partyId === undefined) {
      continue;
    }

    if (!partyCounts.has(player.partyId)) {
      orderedPartyIds.push(player.partyId);
    }

    partyCounts.set(player.partyId, (partyCounts.get(player.partyId) ?? 0) + 1);
  }

  const visuals: Record<string, PartyVisual> = {};
  let visualIndex = 0;

  for (const partyId of orderedPartyIds) {
    const partySize = partyCounts.get(partyId) ?? 0;

    if (partySize < 2) {
      continue;
    }

    visuals[partyId] = {
      className: visualIndex % 2 === 0 ? 'party-accent-1' : 'party-accent-2',
      label: getPartyLabel(partySize),
      title: `Grouped party of ${partySize} players in this lobby.`
    };
    visualIndex += 1;
  }

  return visuals;
}

export function getPlayerPartyVisual(
  player: PrematchPlayer,
  partyVisuals: Record<string, PartyVisual>
): PartyVisual | undefined {
  if (player.partyId === null || player.partyId === undefined) {
    return undefined;
  }

  return partyVisuals[player.partyId];
}

export function getPartyLabel(partySize: number): string {
  if (partySize === 2) {
    return 'Duo';
  }

  if (partySize === 3) {
    return 'Trio';
  }

  return `Stack ${partySize}`;
}

export function getPlayerRowClassName(partyVisual?: PartyVisual): string {
  const classes = ['player-row'];

  if (partyVisual !== undefined) {
    classes.push(partyVisual.className);
  }

  return classes.join(' ');
}
