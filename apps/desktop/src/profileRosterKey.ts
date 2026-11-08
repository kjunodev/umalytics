import type { PrematchRoster } from '@umalytics/shared';

export function profileRosterKey(matchCode: string | undefined, roster: PrematchRoster | undefined): string {
  return JSON.stringify([matchCode, [...new Set(roster?.players.map(player => player.discordId))].sort()]);
}
