import type { EsportsTeamIcon, EsportsTeamIconMap } from '@umalytics/shared';
import { fetchJson } from './apiClient';

const PROFILE_ORIGIN = 'https://drafter.uma.guide';

interface ApiTeamRef {
  teamId?: string;
  name?: string;
  teamName?: string;
  logoUrl?: string;
}

interface ApiLeagueEntry {
  teamA?: ApiTeamRef;
  teamB?: ApiTeamRef;
}

interface ApiLeagueStanding {
  teamId?: string;
  teamName?: string;
  logoUrl?: string;
}

interface ApiLeagueResponse {
  entries?: ApiLeagueEntry[];
  standings?: ApiLeagueStanding[];
}

interface ApiRosterMember {
  discordId?: string;
  displayName?: string;
}

interface ApiTeamDetail {
  id?: string;
  name?: string;
  logoUrl?: string;
  archivedAt?: string | null;
  roster?: ApiRosterMember[];
}

interface ApiTeamResponse {
  team?: ApiTeamDetail;
}

// Team ids only ever come from the league standings/entries; there is no
// "list all teams" endpoint.
export function collectLeagueTeamIds(league: ApiLeagueResponse): string[] {
  const ids = new Set<string>();
  for (const standing of league.standings ?? []) {
    if (typeof standing.teamId === 'string' && standing.teamId.length > 0) ids.add(standing.teamId);
  }
  for (const entry of league.entries ?? []) {
    for (const side of [entry.teamA, entry.teamB]) {
      if (typeof side?.teamId === 'string' && side.teamId.length > 0) ids.add(side.teamId);
    }
  }
  return [...ids];
}

function resolveLogoUrl(logoUrl: string | undefined, origin = PROFILE_ORIGIN): string | undefined {
  if (typeof logoUrl !== 'string' || logoUrl.length === 0) return undefined;
  try {
    return new URL(logoUrl, origin).href;
  } catch {
    return undefined;
  }
}

// Archived teams and players with no roster entry are excluded, so a
// discordId with no active-season team simply has no map entry.
export function buildTeamIconMap(teams: Array<ApiTeamDetail | undefined>): EsportsTeamIconMap {
  const map: EsportsTeamIconMap = {};
  for (const team of teams) {
    if (team === undefined || team.archivedAt !== null && team.archivedAt !== undefined) continue;
    if (typeof team.id !== 'string' || typeof team.name !== 'string') continue;
    const logoUrl = resolveLogoUrl(team.logoUrl);
    if (logoUrl === undefined) continue;
    const icon: EsportsTeamIcon = { teamId: team.id, teamName: team.name, logoUrl };
    for (const member of team.roster ?? []) {
      if (typeof member.discordId === 'string' && member.discordId.length > 0) map[member.discordId] = icon;
    }
  }
  return map;
}

// One team at a time, lowest queue priority, in the background script: this
// never competes with a lobby's own profile fetches. Only the league request
// is load-bearing enough to abort the whole refresh (and keep the old
// cache); a single team failing just means its players get no icon, while
// every other team still makes it into the map.
export async function fetchTeamIconMap(signal: AbortSignal): Promise<EsportsTeamIconMap> {
  const league = await fetchJson<ApiLeagueResponse>('/api/esports/league', signal, 'background', 'esports-league');
  const teamIds = collectLeagueTeamIds(league);
  const teams: ApiTeamDetail[] = [];
  for (const teamId of teamIds) {
    signal.throwIfAborted();
    try {
      const response = await fetchJson<ApiTeamResponse>(
        `/api/esports/teams/${encodeURIComponent(teamId)}`, signal, 'background', 'esports-team'
      );
      if (response.team !== undefined) teams.push(response.team);
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return buildTeamIconMap(teams);
}
