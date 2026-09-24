import type { PrematchPlayer, PrematchRoster, TeamId } from '@umalytics/shared';

export const TEAM_IDS = ['team1', 'team2'] as const satisfies readonly TeamId[];

export const TEAM_SLOT_COUNT = 5;

export function getDraftSlots<T>(items: T[], slotCount: number): Array<T | undefined> {
  const visibleItems = items.slice(0, slotCount);

  return [
    ...visibleItems,
    ...Array<T | undefined>(Math.max(slotCount - visibleItems.length, 0)).fill(undefined)
  ];
}

export function getPlayerKey(player: PrematchPlayer): string {
  return `${player.discordId}:${player.userId}`;
}

export function getDraftRosterPlayersForTeam(
  roster: PrematchRoster | undefined,
  teamId: TeamId
): PrematchPlayer[] {
  const teamPlayers = roster?.teams?.[teamId]?.players;

  if (teamPlayers !== undefined) {
    return teamPlayers;
  }

  return (roster?.players ?? []).filter((player) =>
    player.finalTeam === teamId || player.team === teamId || player.initialTeam === teamId
  );
}
