import type { MatchCode, PrematchPlayer, PrematchRoster, PrematchTeam, TeamId } from '@umalytics/shared';

const TEAM_IDS = ['team1', 'team2'] as const satisfies readonly TeamId[];

const PLAYER_ROLES = new Set(['Player', 'Captain']);

export function extractPrematchRosterFromRoomDom(document: Document): PrematchRoster | null {
  const roomCode = extractRoomCodeFromRoomDom(document);

  if (roomCode === undefined) {
    return null;
  }

  const teams = findTeamSections(document).map((section) => extractTeam(section));
  const players = teams.flatMap((team) => team.players);

  if (players.length === 0) {
    return null;
  }

  return {
    matchCode: roomCode as MatchCode,
    phase: 'room-lobby',
    players,
    teams: Object.fromEntries(teams.map((team) => [team.id, team])) as Record<TeamId, PrematchTeam>
  };
}

export function extractRoomCodeFromRoomDom(document: Document): MatchCode | undefined {
  return normalizeText(
    document.querySelector<HTMLButtonElement>('button[title="Copy room code"]')?.textContent
  ) as MatchCode | undefined;
}

function findTeamSections(document: Document): Array<{ id: TeamId; name?: string; element: HTMLElement }> {
  const root = document.body ?? document.documentElement;
  const rows = findPlayerRows(root);
  const seen = new Set<HTMLElement>();
  const candidates: Array<{ name?: string; element: HTMLElement }> = [];

  for (const row of rows) {
    const element = findTeamElement(row, rows);

    if (element === null || seen.has(element)) {
      continue;
    }

    seen.add(element);
    candidates.push({
      name: readTeamName(element),
      element
    });
  }

  return candidates.sort(compareTeamCandidates).slice(0, TEAM_IDS.length).flatMap((candidate, index) => {
    const id = TEAM_IDS[index];

    return id === undefined ? [] : [{ ...candidate, id }];
  });
}

function findTeamElement(row: HTMLElement, allPlayerRows: HTMLElement[]): HTMLElement | null {
  const withHeading = findClosestTeamElement(row, allPlayerRows, true);

  return withHeading ?? findClosestTeamElement(row, allPlayerRows, false);
}

function findClosestTeamElement(
  row: HTMLElement,
  allPlayerRows: HTMLElement[],
  requireHeading: boolean
): HTMLElement | null {
  const minRows = requireHeading ? 1 : 2;
  let current = row.parentElement;

  while (current !== null && current !== row.ownerDocument.body) {
    const playerRowCount = countContainedRows(current, allPlayerRows);
    const hasTeamHeading = current.querySelector('h2, h3') !== null;

    if (
      playerRowCount >= minRows &&
      playerRowCount <= 5 &&
      (!requireHeading || hasTeamHeading)
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function countContainedRows(element: HTMLElement, rows: HTMLElement[]): number {
  return rows.filter((row) => element.contains(row)).length;
}

function readTeamName(element: HTMLElement): string | undefined {
  return Array.from(element.querySelectorAll<HTMLHeadingElement>('h2, h3'))
    .map((heading) => normalizeText(heading.textContent))
    .find((text) => text !== undefined);
}

function compareTeamCandidates(
  left: { element: HTMLElement },
  right: { element: HTMLElement }
): number {
  const leftRect = left.element.getBoundingClientRect();
  const rightRect = right.element.getBoundingClientRect();
  const verticalDelta = leftRect.top - rightRect.top;

  if (Math.abs(verticalDelta) > 20) {
    return verticalDelta;
  }

  return leftRect.left - rightRect.left;
}

function extractTeam(section: { id: TeamId; name?: string; element: HTMLElement }): PrematchTeam {
  const players = findPlayerRows(section.element).map((row, index) =>
    extractPlayer(row, section.id, index)
  );

  return {
    id: section.id,
    name: section.name ?? (section.id === 'team1' ? 'Team 1' : 'Team 2'),
    players
  };
}

function findPlayerRows(teamElement: HTMLElement): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const rows: HTMLElement[] = [];

  for (const badge of Array.from(teamElement.querySelectorAll<HTMLElement>('span'))) {
    const role = normalizeText(badge.textContent);

    if (role === undefined || !PLAYER_ROLES.has(role)) {
      continue;
    }

    const row = findClosestRow(badge);

    if (row === null || seen.has(row)) {
      continue;
    }

    seen.add(row);
    rows.push(row);
  }

  return rows;
}

function findClosestRow(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;

  while (current !== null) {
    if (current.tagName === 'DIV' && current.querySelector('p') !== null) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function extractPlayer(row: HTMLElement, team: TeamId, index: number): PrematchPlayer {
  const image = row.querySelector<HTMLImageElement>('img[alt]');
  const displayName = normalizeText(image?.alt) ?? readDisplayName(row) ?? `Unknown ${index + 1}`;
  const role = readRole(row);
  const avatarUrl = image?.src;
  const discordId = avatarUrl === undefined ? undefined : extractDiscordIdFromAvatarUrl(avatarUrl);
  const stableDomId = makeStableDomId(team, index, displayName);

  return {
    userId: discordId ?? stableDomId,
    discordId: discordId ?? stableDomId,
    displayName,
    partyId: null,
    partyRatingBonus: 0,
    team,
    role,
    isCaptain: role === 'captain',
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    ...(discordId === undefined
      ? { profileLookupUnavailable: true }
      : { profileUrl: `https://drafter.uma.guide/players/${discordId}` }),
    source: 'room-lobby-dom'
  };
}

function readDisplayName(row: HTMLElement): string | undefined {
  return Array.from(row.querySelectorAll<HTMLParagraphElement>('p'))
    .map((paragraph) => normalizeText(paragraph.textContent))
    .find((text) => text !== undefined);
}

function readRole(row: HTMLElement): string | undefined {
  return Array.from(row.querySelectorAll<HTMLElement>('span'))
    .map((span) => normalizeText(span.textContent))
    .find((text) => text !== undefined && PLAYER_ROLES.has(text))
    ?.toLowerCase();
}

function extractDiscordIdFromAvatarUrl(value: string): string | undefined {
  return /\/avatars\/(\d+)\//.exec(value)?.[1];
}

function makeStableDomId(team: TeamId, index: number, displayName: string): string {
  return `room-dom:${team}:${index}:${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function normalizeText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}
