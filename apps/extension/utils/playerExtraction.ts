import type { MatchCode, PrematchPlayer, PrematchRoster, PrematchTeam, TeamId } from '@umalytics/shared';

const TEAM_IDS = ['team1', 'team2'] as const satisfies readonly TeamId[];

export function normalizePrematchRosterFromPlayers(
  value: unknown,
  matchCode?: MatchCode
): PrematchRoster | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const players = value
    .map(normalizePrematchPlayer)
    .filter((player): player is PrematchPlayer => player !== null);
  const dedupedPlayers = dedupePrematchPlayers(players);

  return {
    ...(matchCode === undefined ? {} : { matchCode }),
    players: dedupedPlayers,
    teams: buildPrematchTeams(dedupedPlayers)
  };
}

export function extractPrematchRosterFromSyncedDraftState(
  value: unknown,
  fallbackMatchCode?: MatchCode
): PrematchRoster | null {
  if (!isRecord(value)) {
    return null;
  }

  const multiplayer = value.syncedDraftState_multiplayer;

  if (!isRecord(multiplayer)) {
    return null;
  }

  const roster = normalizePrematchRosterFromPlayers(
    multiplayer.rankedQueueRoster,
    readOptionalString(multiplayer.roomId) ?? fallbackMatchCode
  );

  if (roster === null) {
    return null;
  }

  const phase = readOptionalString(value.syncedDraftState_phase);
  const currentTeam = readOptionalTeamId(value.syncedDraftState_currentTeam);
  const teams = buildPrematchTeams(roster.players, multiplayer);

  return {
    ...roster,
    ...(phase === undefined ? {} : { phase }),
    ...(currentTeam === undefined ? {} : { currentTeam }),
    ...(teams === undefined ? {} : { teams })
  };
}

export function normalizePrematchPlayer(value: unknown): PrematchPlayer | null {
  if (!isRecord(value)) {
    return null;
  }

  const { userId, discordId, displayName, partyId, partyRatingBonus } = value;

  if (
    typeof userId !== 'string' ||
    typeof discordId !== 'string' ||
    typeof displayName !== 'string' ||
    (typeof partyId !== 'string' && partyId !== null) ||
    typeof partyRatingBonus !== 'number'
  ) {
    return null;
  }

  return {
    userId,
    discordId,
    displayName,
    partyId,
    partyRatingBonus,
    ...readOptionalPlayerFields(value)
  };
}

function buildPrematchTeams(
  players: PrematchPlayer[],
  multiplayer?: Record<string, unknown>
): Record<TeamId, PrematchTeam> | undefined {
  const team1Players = players.filter((player) => player.team === 'team1');
  const team2Players = players.filter((player) => player.team === 'team2');

  if (team1Players.length === 0 && team2Players.length === 0) {
    return undefined;
  }

  return {
    team1: {
      id: 'team1',
      ...readTeamMetadata(multiplayer, 'team1'),
      players: team1Players
    },
    team2: {
      id: 'team2',
      ...readTeamMetadata(multiplayer, 'team2'),
      players: team2Players
    }
  };
}

function dedupePrematchPlayers(players: PrematchPlayer[]): PrematchPlayer[] {
  const seenPlayerIds = new Set<string>();
  const dedupedPlayers: PrematchPlayer[] = [];

  for (const player of players) {
    const stableKey = `${player.discordId}:${player.userId}`;

    if (seenPlayerIds.has(stableKey)) {
      continue;
    }

    seenPlayerIds.add(stableKey);
    dedupedPlayers.push(player);
  }

  return dedupedPlayers;
}

function readOptionalPlayerFields(value: Record<string, unknown>): Partial<PrematchPlayer> {
  const fields: Partial<PrematchPlayer> = {};
  const team = readOptionalTeamId(value.team);
  const initialTeam = readOptionalTeamId(value.initialTeam);
  const finalTeam = readOptionalTeamId(value.finalTeam);
  const role = readOptionalString(value.role);
  const isCaptain = readOptionalBoolean(value.isCaptain);
  const ratingSnapshot = readOptionalNumber(value.ratingSnapshot);
  const rdSnapshot = readOptionalNumber(value.rdSnapshot);
  const displayRatingSnapshot = readOptionalNumber(value.displayRatingSnapshot);
  const displayRdSnapshot = readOptionalNumber(value.displayRdSnapshot);

  if (team !== undefined) fields.team = team;
  if (initialTeam !== undefined) fields.initialTeam = initialTeam;
  if (finalTeam !== undefined) fields.finalTeam = finalTeam;
  if (role !== undefined) fields.role = role;
  if (isCaptain !== undefined) fields.isCaptain = isCaptain;
  if (ratingSnapshot !== undefined) fields.ratingSnapshot = ratingSnapshot;
  if (rdSnapshot !== undefined) fields.rdSnapshot = rdSnapshot;
  if (displayRatingSnapshot !== undefined) fields.displayRatingSnapshot = displayRatingSnapshot;
  if (displayRdSnapshot !== undefined) fields.displayRdSnapshot = displayRdSnapshot;

  return fields;
}

function readTeamMetadata(
  multiplayer: Record<string, unknown> | undefined,
  teamId: TeamId
): Omit<PrematchTeam, 'id' | 'players'> {
  if (multiplayer === undefined) {
    return {};
  }

  const nameKey = `${teamId}Name`;
  const captainKey = `${teamId}CaptainActorUserId`;
  const name = readOptionalString(multiplayer[nameKey]);
  const captainUserId = readOptionalString(multiplayer[captainKey]);

  return {
    ...(name === undefined ? {} : { name }),
    ...(captainUserId === undefined ? {} : { captainUserId })
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readOptionalTeamId(value: unknown): TeamId | undefined {
  return typeof value === 'string' && isTeamId(value) ? value : undefined;
}

function isTeamId(value: string): value is TeamId {
  return TEAM_IDS.includes(value as TeamId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
