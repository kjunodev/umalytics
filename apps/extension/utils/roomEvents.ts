import type { DraftSnapshot, PrematchRoster, TeamId } from '@umalytics/shared';
import { normalizeMatchCode } from './matchDetection';
import { normalizePrematchRosterFromPlayers } from './playerExtraction';
import { getUmaDisplayName, normalizeUmaOutfitId } from './umaPortraits';

type RoomRecord = Record<string, any>;
const ROOM_EVENT_TYPES = new Set(['match.snapshot', 'room.presence.updated', 'participant.uma-assignments.snapshot', 'room.captain.changed']);

/** Decode only the site's documented-in-client server-event envelope. Never scan
 * arbitrary objects for player arrays, chat messages, or saved credentials. */
export function decodeRoomEvent(payload: unknown): RoomRecord | null {
  let event: unknown = payload;
  if (typeof event === 'string') {
    if (event.length > 2_000_000) return null;
    const start = event.indexOf('[');
    try { event = JSON.parse(start >= 0 && /^\d/.test(event) ? event.slice(start) : event); }
    catch { return null; }
  }
  if (Array.isArray(event)) {
    if (event[0] !== 'server:event' || event.length !== 2) return null;
    event = event[1];
  }
  if (!roomRecord(event) || !ROOM_EVENT_TYPES.has(event.type)) return null;
  const matchId = normalizeMatchCode(event.matchId);
  if (matchId === undefined) return null;
  // Whitelist fields before crossing from the page into the extension.
  const base: RoomRecord = { type: event.type, matchId };
  if (event.type === 'match.snapshot') {
    if (!Number.isSafeInteger(event.version) || event.version < 0 || !roomRecord(event.state)) return null;
    const state = event.state;
    if (!roomRecord(state.team1) || !roomRecord(state.team2) || typeof state.phase !== 'string') return null;
    return { ...base, version: event.version, state: {
      phase: state.phase.slice(0,40), currentTeam: state.currentTeam,
      team1: cleanDraftTeam(state.team1), team2: cleanDraftTeam(state.team2),
      wildcardMap: cleanItem(state.wildcardMap), rules: cleanRules(state.rules),
      multiplayer: cleanMultiplayer(state.multiplayer)
    }};
  }
  if (event.type === 'participant.uma-assignments.snapshot') {
    if (!isRoomTeam(event.team) || !Number.isSafeInteger(event.revision) || event.revision < 0 || !Array.isArray(event.roster)) return null;
    return { ...base, team: event.team, revision: event.revision, roster: cleanPlayers(event.roster) };
  }
  if (event.type === 'room.captain.changed') return { ...base, team: event.team,
    captainActorUserId: typeof event.captainActorUserId === 'string' ? event.captainActorUserId.slice(0,100) : undefined };
  return { ...base, ...(Array.isArray(event.participants) ? { participants: cleanPlayers(event.participants) } : {}),
    ...(Array.isArray(event.rankedQueueRoster) ? { rankedQueueRoster: cleanPlayers(event.rankedQueueRoster) } : {}) };
}

function cleanPlayers(values: unknown[]): RoomRecord[] {
  return values.slice(0,32).filter(roomRecord).map(value => {
    const player: RoomRecord = {};
    for (const key of ['userId','actorUserId','discordId','displayName','nickname','discordUsername','team','initialTeam','finalTeam','role','roomRole','partyId']) {
      if (typeof value[key] === 'string') player[key] = value[key].slice(0,120);
      else if (value[key] === null) player[key] = null;
    }
    for (const key of ['ratingSnapshot','rdSnapshot','displayRatingSnapshot','displayRdSnapshot','partyRatingBonus']) {
      if (typeof value[key] === 'number' && Number.isFinite(value[key])) player[key] = value[key];
    }
    if (typeof value.isCaptain === 'boolean') player.isCaptain = value.isCaptain;
    return player;
  });
}
function cleanItem(value: unknown): RoomRecord | undefined {
  if (!roomRecord(value)) return undefined;
  const item: RoomRecord = {};
  for (const key of ['id','name','title','track','surface','direction','variant']) if (typeof value[key] === 'string') item[key] = value[key].slice(0,160);
  if (typeof value.distance === 'number' && Number.isFinite(value.distance)) item.distance = value.distance;
  if (roomRecord(value.conditions)) item.conditions = Object.fromEntries(['season','weather','ground'].filter(key => typeof value.conditions[key] === 'string').map(key => [key,value.conditions[key].slice(0,40)]));
  return item;
}
function cleanDraftTeam(value: RoomRecord): RoomRecord {
  return Object.fromEntries(['pickedUmas','bannedUmas','preBannedUmas','pickedMaps','bannedMaps'].map(key => [key,
    Array.isArray(value[key]) ? value[key].slice(0,32).map(cleanItem).filter(Boolean) : []]));
}
function cleanRules(value: unknown): RoomRecord | undefined {
  if (!roomRecord(value)) return undefined;
  const count = (n: unknown, fallback: number) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 32 ? n : fallback;
  return { maps: count(value.map?.picksPerTeam ?? value.maps,4), picks: count(value.uma?.teamSize ?? value.picks,6), bans: count(value.uma?.preBansPerTeam ?? value.bans,2), vetoes: count(value.uma?.postBansPerTeam ?? value.vetoes,1) };
}
function cleanMultiplayer(value: unknown): RoomRecord {
  if (!roomRecord(value)) return {};
  const output: RoomRecord = {};
  for (const key of ['team1Name','team2Name','team1CaptainActorUserId','team2CaptainActorUserId']) if (typeof value[key] === 'string') output[key] = value[key].slice(0,120);
  if (Array.isArray(value.rankedQueueRoster)) output.rankedQueueRoster = cleanPlayers(value.rankedQueueRoster);
  return output;
}
function roomRecord(value: unknown): value is RoomRecord { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isRoomTeam(value: unknown): value is TeamId { return value === 'team1' || value === 'team2'; }

export class RoomEventState {
  matchCode?: string;
  version = -1;
  revisions = { team1: -1, team2: -1 };
  roster?: PrematchRoster;
  draft?: DraftSnapshot;
  private authoritativeRoster = false;

  apply(payload: unknown, expectedRoom?: string): { roster?: PrematchRoster; draft?: DraftSnapshot; reason: string } {
    const event = decodeRoomEvent(payload);
    if (event === null) return { reason: 'unsupported-event' };
    // Unidentified /host pages must establish identity from visible room UI first.
    if (expectedRoom === undefined || event.matchId !== expectedRoom) return { reason: 'unrelated-room' };
    if (event.matchId !== this.matchCode) {
      this.matchCode = event.matchId; this.version = -1; this.revisions = { team1: -1, team2: -1 };
      this.roster = undefined; this.draft = undefined; this.authoritativeRoster = false;
    }
    if (event.type === 'match.snapshot') {
      if (event.version <= this.version) return { reason: 'old-version' };
      this.version = event.version;
      const state = event.state;
      this.draft = draftFromRoomState(state, event.matchId, event.version);
      if (Array.isArray(state.multiplayer.rankedQueueRoster)) {
        this.roster = this.normalize(state.multiplayer.rankedQueueRoster);
        this.authoritativeRoster = true;
      } else if (this.roster) this.roster = this.normalize(this.roster.players);
      return { roster: this.roster, draft: this.draft, reason: 'match-snapshot' };
    }
    if (event.type === 'participant.uma-assignments.snapshot') {
      const team = event.team as TeamId;
      if (event.revision <= this.revisions[team]) return { reason: 'old-assignment-revision' };
      this.revisions[team] = event.revision;
      // This event is visible per team. It can update one side only.
      const next = this.normalize(event.roster.filter((p: RoomRecord) => p.team === team));
      const assignedIds = new Set(next.players.map(player => player.discordId));
      this.roster = this.normalize([...(this.roster?.players ?? []).filter(p => p.team !== team && !assignedIds.has(p.discordId)), ...next.players]);
      this.authoritativeRoster = true;
      return { roster: this.roster, reason: 'team-assignment' };
    }
    if (event.type === 'room.captain.changed') {
      if (!this.roster || !isRoomTeam(event.team) || !event.captainActorUserId) return { reason: 'captain-without-roster' };
      this.roster = this.normalize(this.roster.players.map(player => player.team !== event.team ? player : {
        ...player, isCaptain: player.userId === event.captainActorUserId,
        role: player.userId === event.captainActorUserId ? 'captain' : 'player'
      }));
      return { roster: this.roster, reason: 'captain-change' };
    }
    if (Array.isArray(event.rankedQueueRoster)) {
      this.roster = this.normalize(event.rankedQueueRoster); this.authoritativeRoster = true;
    } else if (Array.isArray(event.participants)) {
      const incoming = this.normalize(event.participants);
      if (!this.roster || (!this.authoritativeRoster && (!this.draft || this.draft.phase === 'lobby'))) this.roster = incoming;
      else {
        // Presence decorates known members; it never removes or reassigns them.
        const byId = new Map(incoming.players.map(player => [player.discordId, player]));
        this.roster = this.normalize(this.roster.players.map(player => {
          const update = byId.get(player.discordId);
          return update ? { ...player, displayName: update.displayName } : player;
        }));
      }
    } else return { reason: 'presence-without-roster' };
    return { roster: this.roster, reason: 'presence-update' };
  }

  private normalize(players: unknown[]): PrematchRoster {
    const result = normalizePrematchRosterFromPlayers(players, this.matchCode)!;
    return { ...result, phase: this.draft?.phase ?? 'lobby', currentTeam: this.draft?.currentTeam,
      observationSource: 'room-events', teams: {
        team1: { id: 'team1', name: this.draft?.teams.team1.name ?? 'Team 1', players: result.players.filter(p => p.team === 'team1') },
        team2: { id: 'team2', name: this.draft?.teams.team2.name ?? 'Team 2', players: result.players.filter(p => p.team === 'team2') }
      } };
  }
}

function draftFromRoomState(state: RoomRecord, matchCode: string, version: number): DraftSnapshot {
  const teams = {} as DraftSnapshot['teams'];
  for (const team of ['team1','team2'] as const) {
    const value = state[team];
    const maps = [...value.pickedMaps.map((m: RoomRecord, index: number) => ({ team, mapId: m.id, name: m.track ?? m.name ?? m.id,
      details: mapDetails(m), order: index * 2 + (team === 'team1' ? 1 : 2), status: 'selected' as const })),
      ...value.bannedMaps.map((m: RoomRecord) => ({ team, mapId: m.id, name: m.track ?? m.name ?? m.id, details: mapDetails(m), status: 'vetoed' as const }))];
    const umas = (['pickedUmas','preBannedUmas','bannedUmas'] as const).flatMap((key, kindIndex) => value[key].map((uma: RoomRecord,index: number) => ({
      team, kind: (['pick','ban','veto'] as const)[kindIndex]!, umaId: normalizeUmaOutfitId(String(uma.id ?? '')),
      name: getUmaDisplayName(String(uma.id ?? ''), uma.name), order: index + 1
    })));
    teams[team] = { id: team, name: state.multiplayer[team + 'Name'] ?? (team === 'team1' ? 'Team 1' : 'Team 2'), maps, umas };
  }
  return { matchCode, version, phase: state.phase, currentTeam: isRoomTeam(state.currentTeam) ? state.currentTeam : undefined,
    source: 'synced-draft-state', teams, updatedAt: Date.now(), rules: state.rules,
    ...(state.wildcardMap ? { tiebreakerMap: { name: state.wildcardMap.track ?? state.wildcardMap.name, details: mapDetails(state.wildcardMap) } } : {}) };
}
function mapDetails(map: RoomRecord): string {
  return [map.distance ? `${map.distance}m` : undefined, map.surface, map.variant, map.direction,
    map.conditions?.season, map.conditions?.weather, map.conditions?.ground].filter(Boolean).join(' • ');
}
