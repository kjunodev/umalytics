import { normalizeMatchCode } from './matchDetection';
import type { MatchCode, PrematchPlayer, PrematchRoster, PrematchTeam, TeamId } from '@umalytics/shared';
import { cleanTeamName } from './textCleanup';

const TEAM_IDS = ['team1', 'team2'] as const satisfies readonly TeamId[];

const PLAYER_ROLES = new Set(['Player', 'Captain']);

export function extractPrematchRosterFromRoomDom(document: Document): PrematchRoster | null {
  const roomCode = extractRoomCodeFromRoomDom(document);
  // Trainer rows are also used for captain summaries in draft screens. A
  // waiting-room roster needs its own room identity and both team sections.
  if (roomCode === undefined) return null;
  const sections = findTeamSections(document);
  if (sections.length !== 2) return null;
  const teams = buildTeamRecord(sections.map((section) => extractTeam(section)));
  const players = teams.flatMap((team) => team.players);

  if (teams.every(team => team.name === undefined) && players.length === 0) {
    return null;
  }

  return {
    ...(roomCode === undefined ? {} : { matchCode: roomCode as MatchCode }),
    phase: 'room-lobby',
    players,
    teams: Object.fromEntries(teams.map((team) => [team.id, team])) as Record<TeamId, PrematchTeam>
  };
}

export function extractRoomCodeFromRoomDom(document: Document): MatchCode | undefined {
  const copyButtonCode = normalizeRoomCode(
    document.querySelector<HTMLButtonElement>('button[aria-label="Copy room code" i], button[title*="room code" i]')?.textContent
  );

  if (copyButtonCode !== undefined) {
    return copyButtonCode as MatchCode;
  }

  const labeledTextCode = Array.from(document.querySelectorAll<HTMLElement>('button, span, p, div'))
    .filter((element) => /\broom\s+code\b/i.test(element.textContent ?? ''))
    .map((element) => normalizeRoomCode(element.textContent))
    .find((code) => code !== undefined);

  return labeledTextCode as MatchCode | undefined;
}

function findTeamSections(document: Document): Array<{ id: TeamId; name?: string; element: HTMLElement }> {
  const root = document.body ?? document.documentElement;
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h2, h3'));
  const sections: Array<{ id: TeamId; name?: string; element: HTMLElement }> = [];
  for (const heading of headings) {
    let element = heading.parentElement;
    while (element !== null && element !== root) {
      if (element.querySelectorAll('h2, h3').length > 1) break;
      if (findPlayerRows(element).length > 0 ||
          Array.from(element.querySelectorAll('p')).some(p => /Waiting for player/i.test(p.textContent ?? ''))) {
        if (!sections.some(section => section.element === element)) sections.push({ id: 'team1', name: cleanTeamName(normalizeText(heading.textContent)), element });
        break;
      }
      element = element.parentElement;
    }
  }
  if (sections.length === 2) return sections.sort(compareTeamCandidates).map((section, index) => ({ ...section, id: TEAM_IDS[index]! }));
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
    .map((heading) => cleanTeamName(normalizeText(heading.textContent)))
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

function buildTeamRecord(discoveredTeams: PrematchTeam[]): PrematchTeam[] {
  const teamsById = new Map(discoveredTeams.map((team) => [team.id, team] as const));

  return TEAM_IDS.map((id) => teamsById.get(id) ?? {
    id,
    name: id === 'team1' ? 'Team 1' : 'Team 2',
    players: []
  });
}

function findPlayerRows(teamElement: HTMLElement): HTMLElement[] {
  const marked = Array.from(teamElement.querySelectorAll<HTMLElement>('[data-trainer-player]'))
    .filter(row => readRole(row) !== undefined);
  if (marked.length > 0) return marked;
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
  const marked = element.closest<HTMLElement>('[data-trainer-player]');
  if (marked !== null) return marked;
  let current: HTMLElement | null = element;

  while (current !== null && current !== element.ownerDocument.body) {
    if (current.querySelector('h2, h3') !== null) break;
    const badges = Array.from(current.querySelectorAll<HTMLElement>('span')).filter(span =>
      PLAYER_ROLES.has(normalizeText(span.textContent) ?? '') &&
      !Array.from(span.querySelectorAll('span')).some(child => PLAYER_ROLES.has(normalizeText(child.textContent) ?? '')));
    if (badges.length > 1) break;
    if (current.tagName === 'DIV' && badges.length === 1 && current.querySelector('p') !== null) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function extractPlayer(row: HTMLElement, team: TeamId, index: number): PrematchPlayer {
  const images = Array.from(row.querySelectorAll<HTMLImageElement>('img'));
  const image = images.find(image => isDiscordAvatar(image.src));
  const displayName = readDisplayName(row) ?? normalizeText(image?.alt) ?? `Unknown ${index + 1}`;
  const role = readRole(row);
  const avatarUrl = image?.src;
  const discordId = extractDiscordIdFromRow(row, images);
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
  // The avatar trigger may contain an initial or companion, not a player name.
  const triggers = Array.from(row.querySelectorAll<HTMLElement>('[data-trainer-trigger]'));
  const labeledName = triggers.map(button => /^View (.+)'s trainer card$/.exec(button.getAttribute('aria-label') ?? '')?.[1])
    .map(normalizeText).find(name => name !== undefined);
  if (labeledName !== undefined) return labeledName;
  const nameButton = triggers
    .find(button => button.querySelector('img') === null && normalizeText(button.textContent) !== undefined);
  if (nameButton !== undefined) return normalizeText(nameButton.textContent);
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
  if (!isDiscordAvatar(value)) return undefined;
  const path = new URL(value).pathname;
  return /^\/avatars\/(\d{16,20})\//.exec(path)?.[1] ??
    /^\/guilds\/\d+\/users\/(\d{16,20})\/avatars\//.exec(path)?.[1];
}

function isDiscordAvatar(value: string): boolean {
  try {
    const url = new URL(value);
    return ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) &&
      /\/(?:avatars|embed\/avatars)\//.test(url.pathname);
  } catch { return false; }
}

function extractDiscordIdFromRow(row: HTMLElement, images: HTMLImageElement[]): string | undefined {
  const ids = new Set<string>();
  for (const link of Array.from(row.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    try {
      const url = new URL(link.getAttribute('href')!, 'https://drafter.uma.guide');
      if (url.origin === 'https://drafter.uma.guide') {
        const id = /^\/players\/(\d{16,20})\/?$/.exec(url.pathname)?.[1];
        if (id !== undefined) ids.add(id);
      }
    } catch { /* Ignore non-URL links. */ }
  }
  for (const element of [row, ...Array.from(row.querySelectorAll<HTMLElement>('[data-discord-id], [data-user-id], [data-actor-user-id]'))]) {
    for (const attribute of ['data-discord-id', 'data-user-id', 'data-actor-user-id']) {
      const id = element.getAttribute(attribute);
      if (id !== null && /^\d{16,20}$/.test(id)) ids.add(id);
    }
  }
  for (const image of images) {
    const id = extractDiscordIdFromAvatarUrl(image.src);
    if (id !== undefined) ids.add(id);
  }
  // Conflicting identities signal a bad row boundary; never guess a player.
  return ids.size === 1 ? [...ids][0] : undefined;
}

function makeStableDomId(team: TeamId, index: number, displayName: string): string {
  return `room-dom:${team}:${index}:${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function normalizeText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function normalizeRoomCode(value: string | null | undefined): string | undefined {
  const text = normalizeText(value);

  if (text === undefined) {
    return undefined;
  }

  return normalizeMatchCode(text) ?? normalizeMatchCode(/\broom\s+code\b\s*:?\s*([A-Z0-9]{3}-?[A-Z0-9]{3})\b/i.exec(text)?.[1]);
}
