import type { PrematchRoster, PrematchPlayer, PrematchTeam, TeamId } from '@umalytics/shared';
const DISPLAY_TEAM_IDS = ['team1', 'team2'] as const;

export function getTeamGroups(roster: PrematchRoster | undefined): PrematchTeam[] {
  if (roster === undefined) {
    return [];
  }

  if (roster.teams !== undefined) {
    const groups = DISPLAY_TEAM_IDS.map((teamId) => roster.teams?.[teamId]).filter(
      (team): team is PrematchTeam => team !== undefined
    );
    return groups;
  }

  return [
    {
      id: 'team1',
      players: roster.players
    }
  ];
}

export function normalizeRosterForDisplay(roster: PrematchRoster | undefined): PrematchRoster | undefined {
  if (roster === undefined) return undefined;
  const players = dedupePlayersByIdentity(roster.players).map(player => ({
    ...player, team: player.team === null ? undefined : player.team ?? player.finalTeam ?? player.initialTeam
  })).filter(player => (player.team === 'team1' || player.team === 'team2') &&
    !['spectator', 'staff'].includes(player.role?.toLowerCase() ?? ''));
  // Apply the same slot selection to fetching, counts, locks and all scouting scenes.
  return {
    ...roster, players,
    teams: Object.fromEntries(DISPLAY_TEAM_IDS.map(id => [id, {
      ...roster.teams?.[id], id, players: players.filter(player => player.team === id)
    }])) as Record<TeamId, PrematchTeam>
  };
}

function dedupePlayersByIdentity(players: PrematchPlayer[]): PrematchPlayer[] {
  const seenPlayerIds = new Set<string>();
  const dedupedPlayers: PrematchPlayer[] = [];

  for (const player of players) {
    const stableKey = getStablePlayerIdentity(player);

    if (seenPlayerIds.has(stableKey)) {
      continue;
    }

    seenPlayerIds.add(stableKey);
    dedupedPlayers.push(player);
  }

  return dedupedPlayers;
}

function getStablePlayerIdentity(player: PrematchPlayer): string {
  return player.discordId || player.userId;
}
