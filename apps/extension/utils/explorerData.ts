import type { DraftMapSelection, DraftSnapshot, DraftUmaAction, PrematchPlayer, PrematchRoster, TeamId } from '@umalytics/shared';
import type { HistoricalMatch, PlayerSearchResult } from './explorerTypes';
import { normalizeMatchCode } from './matchDetection';
import { getUmaDisplayName, getUmaPortraitUrl, normalizeUmaOutfitId } from './umaPortraits';

const record = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const side = (value: unknown): TeamId | undefined => value === 'team1' || value === 'team2' ? value : undefined;
const snowflake = (value: unknown): string | undefined => typeof value === 'string' && /^\d{16,20}$/.test(value) ? value : undefined;

function routeInput(input: string, route: 'matches' | 'players'): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 300) throw new Error('Enter a valid match code, player name, ID, or drafter URL.');
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  const url = new URL(trimmed);
  const match = new RegExp(`^/${route}/([^/]+)/?$`).exec(url.pathname);
  if (url.origin !== 'https://drafter.uma.guide' || url.username || url.password || !match?.[1]) {
    throw new Error(`Use a https://drafter.uma.guide/${route}/ URL.`);
  }
  return decodeURIComponent(match[1]);
}

export function parseHistoryInput(input: string): string {
  const code = normalizeMatchCode(routeInput(input, 'matches'));
  if (!code) throw new Error('Enter a six-character match code, such as TG7YT2, or its match URL.');
  return code;
}

export function parsePlayerInput(input: string): { id?: string; query?: string } {
  const value = routeInput(input, 'players');
  const id = snowflake(value);
  if (id) return { id };
  if (/^https?:\/\//i.test(input.trim()) || /^\d+$/.test(value)) throw new Error('Enter a valid Discord ID or player profile URL.');
  if (value.length < 2 || value.length > 80) throw new Error('Enter between 2 and 80 characters to search players.');
  return { query: value };
}

export function lookupPlayer(id: string, name = id): PrematchPlayer {
  if (!snowflake(id)) throw new Error('Invalid player ID.');
  return { discordId: id, userId: id, displayName: name, partyId: null, partyRatingBonus: 0,
    profileUrl: `https://drafter.uma.guide/players/${id}` };
}

export function parsePlayerSearch(value: unknown, page = 1): PlayerSearchResult {
  if (!Array.isArray(record(value).players)) throw new Error('Player search returned an unsupported response.');
  const seen = new Set<string>();
  const players = rows(record(value).players).flatMap(player => {
    const id = snowflake(player.discordId);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [lookupPlayer(id, text(player.discordUsername) ?? id)];
  });
  const pageSize = 10;
  return { players: players.slice((page - 1) * pageSize, page * pageSize), total: players.length, page, pageSize };
}

function mapSelection(value: Record<string, unknown>, team: TeamId, status: 'selected' | 'vetoed', order?: number): DraftMapSelection {
  const conditions = record(value.conditions);
  return { team, mapId: text(value.id), name: text(value.name) ?? text(value.track) ?? 'Unknown map', status, order,
    details: [conditions.season, conditions.weather, conditions.ground].filter(part => typeof part === 'string').join(' • ') || undefined };
}

/** Read explicit final team arrays, never walk available pools or replay vetoed picks as final picks. */
export function parseHistoricalMatch(value: unknown, requestedCode: string): HistoricalMatch {
  const match = record(value), report = record(match.report), saved = record(report.draftSnapshot);
  const code = normalizeMatchCode(match.id ?? report.matchId);
  if (code !== requestedCode) throw new Error('The server returned a different match. Please try again.');
  if (!Object.keys(saved).length || !Object.keys(record(saved.team1)).length || !Object.keys(record(saved.team2)).length) {
    throw new Error('This match does not have a saved draft to display.');
  }
  if (saved.phase !== 'complete' && match.status !== 'completed') throw new Error('This draft is not complete yet. Use Live to follow it.');
  for (const team of ['team1', 'team2'] as const) {
    const raw = record(saved[team]);
    for (const field of ['pickedMaps', 'bannedMaps', 'pickedUmas', 'preBannedUmas', 'bannedUmas']) {
      const items = raw[field];
      if (!Array.isArray(items) || items.length > 32 || items.some(item => {
        const entry = record(item);
        return !text(entry.name) || !text(entry.id);
      })) throw new Error('This saved draft uses an unsupported format. Open the match on Uma Drafter.');
    }
  }
  const multiplayer = record(saved.multiplayer);
  const warnings: string[] = [];
  const roster: PrematchRoster = { matchCode: code, phase: 'complete', observationSource: 'match-history', players: [], teams: {
    team1: { id: 'team1', name: text(multiplayer.team1Name) ?? 'Team 1', players: [] },
    team2: { id: 'team2', name: text(multiplayer.team2Name) ?? 'Team 2', players: [] }
  } };
  const participants = Array.isArray(report.participants) && report.participants.length ? rows(report.participants) : rows(multiplayer.rankedQueueRoster);
  const seen = new Set<string>();
  for (const participant of participants) {
    const team = side(participant.team) ?? side(participant.finalTeam);
    if (!team || participant.role === 'spectator') continue;
    const id = snowflake(participant.discordId);
    if (!id) { warnings.push('Some historical participants have no profile ID. Their stats cannot be loaded.'); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    const player = { ...lookupPlayer(id, text(participant.displayDiscordUsername) ?? text(participant.displayName) ?? id),
      team, isCaptain: participant.isCaptain === true || participant.role === 'captain' };
    roster.players.push(player);
    roster.teams![team].players.push(player);
  }
  const actions = rows(saved.draftActionHistory);
  const rules = record(saved.rules), mapRules = record(rules.map), umaRules = record(rules.uma);
  const count = (value: unknown, fallback: number) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 20 ? value : fallback;
  const draft: DraftSnapshot = { matchCode: code, phase: 'complete', source: 'match-history', updatedAt: Date.now(),
    teams: { team1: { id: 'team1', name: roster.teams!.team1.name, maps: [], umas: [] }, team2: { id: 'team2', name: roster.teams!.team2.name, maps: [], umas: [] } },
    rules: { maps: count(mapRules.picksPerTeam, 0), picks: count(umaRules.teamSize, 0), bans: count(umaRules.preBansPerTeam, 0), vetoes: count(umaRules.postBansPerTeam, 0) }
  };
  for (const team of ['team1', 'team2'] as const) {
    const raw = record(saved[team]), target = draft.teams[team];
    const mapPicks = actions.filter(action => action.action === 'map-pick');
    for (const [key, status] of [['pickedMaps', 'selected'], ['bannedMaps', 'vetoed']] as const) {
      for (const map of rows(raw[key])) {
        const order = mapPicks.findIndex(action => action.actorTeam === team && record(action.map).id === map.id);
        target.maps.push(mapSelection(map, team, status, order < 0 ? undefined : order + 1));
      }
    }
    target.maps.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    for (const [key, kind] of [['pickedUmas', 'pick'], ['preBannedUmas', 'ban'], ['bannedUmas', 'veto']] as const) {
      for (const uma of rows(raw[key])) {
        const id = text(uma.id);
        const umaId = id ? normalizeUmaOutfitId(id) : undefined;
        const fallback = [text(uma.title), text(uma.name)].filter(Boolean).join(' ') || 'Unknown Uma';
        const item: DraftUmaAction = { team, kind, umaId, name: umaId ? getUmaDisplayName(umaId, fallback) : fallback,
          imageUrl: umaId ? getUmaPortraitUrl(umaId) : undefined };
        target.umas.push(item);
      }
    }
  }
  if (Object.keys(record(saved.wildcardMap)).length) {
    const wildcard = mapSelection(record(saved.wildcardMap), 'team1', 'selected');
    draft.tiebreakerMap = { name: wildcard.name, details: wildcard.details };
  }
  if (roster.players.length === 0) warnings.push('No player IDs were saved with this match. The completed draft is still available.');
  // No historical rating snapshots are passed into the current-profile renderer.
  return { matchCode: code, roster, draft, completedAt: text(report.finishedAt) ?? text(report.reportedAt),
    status: text(match.status) ?? 'completed', warnings: [...new Set(warnings)] };
}
