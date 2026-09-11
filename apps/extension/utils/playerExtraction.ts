import { readPayloadRoomCode } from './syncPayload';
import type { MatchCode, PrematchPlayer, PrematchRoster, PrematchTeam, TeamId } from '@umalytics/shared';
import { cleanTeamName } from './textCleanup';

const TEAM_IDS = ['team1', 'team2'] as const satisfies readonly TeamId[];

export function normalizePrematchRosterFromPlayers(
  value: unknown,
  matchCode?: MatchCode,
  context?: Record<string, unknown>
): PrematchRoster | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const players = value.flatMap((player) => {
    const normalizedPlayer = normalizePrematchPlayer(player, context);

    return normalizedPlayer === null
      ? []
      : [{
          ...normalizedPlayer,
          source: normalizedPlayer.source ?? 'synced-draft-state'
        } satisfies PrematchPlayer];
  });
  const dedupedPlayers = dedupePrematchPlayers(players.filter(player => player.team === 'team1' || player.team === 'team2'));

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

  const rosterPlayers = getRosterPlayers(multiplayer);
  const roster = normalizePrematchRosterFromPlayers(
    rosterPlayers,
    readPayloadRoomCode(multiplayer) ?? fallbackMatchCode,
    multiplayer
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

export function normalizePrematchPlayer(
  value: unknown,
  context?: Record<string, unknown>
): PrematchPlayer | null {
  if (!isRecord(value)) {
    return null;
  }

  const userId = readOptionalString(value.userId)
    ?? readOptionalString(value.actorUserId)
    ?? readOptionalString(value.discordId)
    ?? readOptionalString(value.id);
  const discordId = readOptionalString(value.discordId)
    ?? readOptionalString(value.actorUserId)
    ?? readOptionalString(value.userId)
    ?? readOptionalString(value.id);
  const identityKeys = [userId, discordId, readOptionalString(value.actorUserId), readOptionalString(value.id)]
    .filter((key): key is string => key !== undefined);
  const displayName = readOptionalString(value.displayName)
    ?? readOptionalString(value.nickname)
    ?? readOptionalString(value.username)
    ?? readOptionalString(value.discordUsername)
    ?? readOptionalString(value.playerName)
    ?? readOptionalString(value.name)
    ?? readContextString(context, identityKeys, [
      'participantNicknames',
      'participantDisplayNames',
      'participantNames',
      'playerNicknames',
      'playerDisplayNames',
      'playerNames',
      'nicknames',
      'displayNames'
    ]);
  const partyId = readOptionalString(value.partyId) ?? null;
  const partyRatingBonus = readOptionalNumber(value.partyRatingBonus) ?? 0;
  const excludedRole = [value.roomRole, value.role, value.type].some(role =>
    typeof role === 'string' && ['staff', 'spectator'].includes(role.toLowerCase()));

  if (excludedRole) {
    return null;
  }

  if (
    userId === undefined ||
    discordId === undefined ||
    displayName === undefined
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

function getRosterPlayers(multiplayer: Record<string, unknown>): unknown {
  if (Array.isArray(multiplayer.rankedQueueRoster)) {
    return multiplayer.rankedQueueRoster;
  }

  if (Array.isArray(multiplayer.participants)) {
    return multiplayer.participants;
  }

  if (Array.isArray(multiplayer.players)) {
    return multiplayer.players;
  }

  return multiplayer.roomPlayers;
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
    const stableKey = player.discordId || player.userId;

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
  // An explicit null current team means the player has left the slots.
  const team = value.team === null ? undefined :
    readOptionalTeamId(value.team) ?? readOptionalTeamId(value.finalTeam) ?? readOptionalTeamId(value.initialTeam);
  const initialTeam = readOptionalTeamId(value.initialTeam);
  const finalTeam = readOptionalTeamId(value.finalTeam);
  const role = readOptionalString(value.role) ?? readOptionalString(value.roomRole) ?? readOptionalString(value.type);
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

function readContextString(
  context: Record<string, unknown> | undefined,
  keys: string[],
  mapNames: string[]
): string | undefined {
  if (context === undefined || keys.length === 0) {
    return undefined;
  }

  for (const mapName of mapNames) {
    const map = context[mapName];

    if (!isRecord(map)) {
      continue;
    }

    for (const key of keys) {
      const value = readOptionalString(map[key]);

      if (value !== undefined) {
        return value;
      }
    }
  }

  return undefined;
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
  const name = cleanTeamName(readOptionalString(multiplayer[nameKey]));
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
  if (typeof value === 'number') {
    return value === 1 ? 'team1' : value === 2 ? 'team2' : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]+/g, '');

  if (normalizedValue === 'team1' || normalizedValue === '1' || normalizedValue === 'blue') {
    return 'team1';
  }

  if (normalizedValue === 'team2' || normalizedValue === '2' || normalizedValue === 'red') {
    return 'team2';
  }

  return isTeamId(value) ? value : undefined;
}

function isTeamId(value: string): value is TeamId {
  return TEAM_IDS.includes(value as TeamId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
