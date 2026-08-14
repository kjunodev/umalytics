import type {
  DraftMapSelection,
  DraftSnapshot,
  DraftTeamSnapshot,
  DraftTiebreakerMap,
  DraftUmaAction,
  DraftUmaActionKind,
  MatchCode,
  TeamId
} from '@umalytics/shared';
import { extractRoomCodeFromRoomDom } from './domLobbyExtraction';
import { getUmaDisplayName, normalizeUmaOutfitId } from './umaPortraits';

const TEAM_IDS = ['team1', 'team2'] as const satisfies readonly TeamId[];

export function extractDraftSnapshotFromSyncedDraftState(
  value: unknown,
  fallbackMatchCode?: MatchCode
): DraftSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const multiplayer = isRecord(value.syncedDraftState_multiplayer)
    ? value.syncedDraftState_multiplayer
    : undefined;
  const phase = readOptionalString(value.syncedDraftState_phase);
  const currentTeam = readOptionalTeamId(value.syncedDraftState_currentTeam);
  const matchCode = readOptionalString(multiplayer?.roomId) ?? fallbackMatchCode;
  const teams = createEmptyTeams(multiplayer);
  const umas = collectSyncedUmaActions(value);
  const maps = collectSyncedMaps(value);
  const tiebreakerMap = extractSyncedTiebreakerMap(value);

  for (const uma of umas) {
    teams[uma.team].umas.push(uma);
  }

  for (const map of maps) {
    teams[map.team].maps.push(map);
  }

  if (umas.length === 0 && maps.length === 0 && tiebreakerMap === undefined) {
    return null;
  }

  return {
    ...(matchCode === undefined ? {} : { matchCode: matchCode as MatchCode }),
    ...(phase === undefined ? {} : { phase }),
    ...(currentTeam === undefined ? {} : { currentTeam }),
    ...(tiebreakerMap === undefined ? {} : { tiebreakerMap }),
    source: 'synced-draft-state',
    teams,
    updatedAt: Date.now()
  };
}

export function extractDraftSnapshotFromDraftDom(document: Document): DraftSnapshot | null {
  const panels = findDraftTeamPanels(document);

  if (panels.length === 0) {
    return null;
  }

  const teams = createEmptyTeams();

  for (const panel of panels) {
    teams[panel.id] = {
      id: panel.id,
      name: panel.name,
      maps: extractDomMaps(panel.id, panel.element),
      umas: extractDomUmaActions(panel.id, panel.element)
    };
  }

  const hasDraftData = TEAM_IDS.some(
    (teamId) => teams[teamId].maps.length > 0 || teams[teamId].umas.length > 0
  );
  const tiebreakerMap = extractDomTiebreakerMap(document);

  if (!hasDraftData && tiebreakerMap === undefined) {
    return null;
  }

  const matchCode = extractRoomCodeFromRoomDom(document);

  return {
    ...(matchCode === undefined ? {} : { matchCode }),
    ...(tiebreakerMap === undefined ? {} : { tiebreakerMap }),
    source: 'draft-dom',
    teams,
    updatedAt: Date.now()
  };
}

function createEmptyTeams(multiplayer?: Record<string, unknown>): Record<TeamId, DraftTeamSnapshot> {
  return {
    team1: {
      id: 'team1',
      name: readOptionalString(multiplayer?.team1Name) ?? 'Team 1',
      maps: [],
      umas: []
    },
    team2: {
      id: 'team2',
      name: readOptionalString(multiplayer?.team2Name) ?? 'Team 2',
      maps: [],
      umas: []
    }
  };
}

function collectSyncedUmaActions(value: unknown): DraftUmaAction[] {
  const actions: DraftUmaAction[] = [];
  const seen = new Set<string>();

  walkDraftRecords(value, [], (record, path) => {
    const umaId = readUmaId(record);
    const rawName = readOptionalString(record.name)
      ?? readOptionalString(record.umaName)
      ?? readOptionalString(record.charaName)
      ?? readOptionalString(record.cardName)
      ?? umaId;
    const name = umaId === undefined ? rawName : getUmaDisplayName(umaId, rawName);
    const team = readOptionalTeamId(record.team)
      ?? readOptionalTeamId(record.currentTeam)
      ?? readTeamFromPath(path);

    if (name === undefined || team === undefined) {
      return;
    }

    const kind = readUmaActionKind(record, path);
    const order = readOptionalNumber(record.order) ?? readOptionalNumber(record.pickOrder);
    const key = `${kind}:${team}:${umaId ?? name}:${order ?? actions.length}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    actions.push({
      kind,
      team,
      ...(umaId === undefined ? {} : { umaId }),
      name,
      ...(order === undefined ? {} : { order })
    });
  });

  return actions.sort(compareOrderedDraftItems);
}

function collectSyncedMaps(value: unknown): DraftMapSelection[] {
  const maps: DraftMapSelection[] = [];
  const seen = new Set<string>();

  walkDraftRecords(value, [], (record, path) => {
    const name = readOptionalString(record.mapName)
      ?? readOptionalString(record.raceName)
      ?? readOptionalString(record.courseName);
    const team = readOptionalTeamId(record.team)
      ?? readOptionalTeamId(record.currentTeam)
      ?? readTeamFromPath(path);

    if (name === undefined || team === undefined || !pathContainsDraftMapHint(path)) {
      return;
    }

    const order = readOptionalNumber(record.order) ?? readOptionalNumber(record.pickOrder);
    const details = [record.distance, record.surface, record.direction]
      .map((part) => readOptionalString(part) ?? (typeof part === 'number' ? String(part) : undefined))
      .filter((part): part is string => part !== undefined)
      .join(' - ');
    const key = `${team}:${name}:${order ?? maps.length}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    maps.push({
      team,
      name,
      ...(details.length === 0 ? {} : { details }),
      ...(order === undefined ? {} : { order })
    });
  });

  return maps.sort(compareOrderedDraftItems);
}

function extractSyncedTiebreakerMap(value: unknown): DraftTiebreakerMap | undefined {
  let tiebreakerMap: DraftTiebreakerMap | undefined;

  walkDraftRecords(value, [], (record, path) => {
    if (tiebreakerMap !== undefined) {
      return;
    }

    const explicitText = readOptionalString(record.tiebreaker)
      ?? readOptionalString(record.tieBreaker)
      ?? readOptionalString(record.tiebreakerMap)
      ?? readOptionalString(record.tieBreakerMap);

    if (explicitText !== undefined) {
      tiebreakerMap = parseTiebreakerMapText(explicitText);
      return;
    }

    if (!path.join('.').toLowerCase().includes('tie')) {
      return;
    }

    const name = readOptionalString(record.mapName)
      ?? readOptionalString(record.raceName)
      ?? readOptionalString(record.courseName);

    if (name === undefined) {
      return;
    }

    const details = [record.distance, record.surface, record.direction]
      .map((part) => readOptionalString(part) ?? (typeof part === 'number' ? String(part) : undefined))
      .filter((part): part is string => part !== undefined)
      .join(' - ');

    tiebreakerMap = {
      name,
      ...(details.length === 0 ? {} : { details })
    };
  });

  return tiebreakerMap;
}

function walkDraftRecords(
  value: unknown,
  path: string[],
  visit: (record: Record<string, unknown>, path: string[]) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkDraftRecords(item, [...path, String(index)], visit);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  visit(value, path);

  for (const [key, child] of Object.entries(value)) {
    if (key === 'rankedQueueRoster') {
      continue;
    }

    walkDraftRecords(child, [...path, key], visit);
  }
}

function findDraftTeamPanels(document: Document): Array<{ id: TeamId; name: string; element: HTMLElement }> {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('section, div'))
    .filter((element) => {
      const headings = Array.from(element.querySelectorAll('h2, h3')).map((heading) =>
        normalizeText(heading.textContent)?.toLowerCase()
      );

      return headings.some((text) => text?.includes('maps') === true) &&
        headings.some((text) => text?.includes('umamusume') === true);
    })
    .filter((element) => !Array.from(element.children).some((child) => {
      if (!(child instanceof HTMLElement)) {
        return false;
      }

      const childText = normalizeText(child.textContent)?.toLowerCase() ?? '';
      return childText.includes('maps') && childText.includes('umamusume');
    }));

  return candidates
    .sort(compareElementsByPosition)
    .slice(0, TEAM_IDS.length)
    .flatMap((element, index) => {
      const id = TEAM_IDS[index];

      if (id === undefined) {
        return [];
      }

      return [{
        id,
        name: readFirstHeading(element) ?? (id === 'team1' ? 'Team 1' : 'Team 2'),
        element
      }];
    });
}

function extractDomMaps(team: TeamId, panel: HTMLElement): DraftMapSelection[] {
  return Array.from(panel.querySelectorAll<HTMLElement>('[aria-label*="map helper" i]'))
    .flatMap((element, index) => {
      const ariaLabel = element.getAttribute('aria-label') ?? '';
      const ariaName = /^Open\s+(.+?)\s+map helper$/i.exec(ariaLabel)?.[1];
      const lines = getTextLines(element);
      const name = ariaName ?? lines.find((line) => !isDraftMapOrder(line));

      if (name === undefined || name === '?') {
        return [];
      }

      const details = lines
        .filter((line) => line !== name && !isDraftMapOrder(line) && !isDraftCrossMark(line))
        .join(' - ');
      const status = element.querySelector('.line-through') !== null ? 'vetoed' : 'selected';

      return [{
        team,
        name,
        ...(details.length === 0 ? {} : { details }),
        order: index + 1,
        status
      } satisfies DraftMapSelection];
    });
}

function extractDomTiebreakerMap(document: Document): DraftTiebreakerMap | undefined {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, p, span, div'))
    .map((element) => normalizeText(element.textContent))
    .filter((text): text is string => text !== undefined && /tiebreaker\s*:/i.test(text))
    .sort((left, right) => left.length - right.length);

  for (const text of candidates) {
    const tiebreakerMap = parseTiebreakerMapText(text);

    if (tiebreakerMap !== undefined) {
      return tiebreakerMap;
    }
  }

  return undefined;
}

function extractDomUmaActions(team: TeamId, panel: HTMLElement): DraftUmaAction[] {
  const seen = new Set<string>();
  const actions: DraftUmaAction[] = [];

  for (const image of Array.from(panel.querySelectorAll<HTMLImageElement>('img[alt]'))) {
    const name = normalizeText(image.alt);

    if (name === undefined) {
      continue;
    }

    const card = findClosestDraftCard(image);
    const cardText = normalizeText(card?.textContent)?.toLowerCase() ?? '';
    const kind = cardText.includes('vetoed')
      ? 'veto'
      : cardText.includes('banned')
        ? 'ban'
        : 'pick';
    const umaId = extractUmaIdFromImageUrl(image.src);
    const displayName = umaId === undefined ? name : getUmaDisplayName(umaId, name);
    const key = `${kind}:${team}:${umaId ?? name}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    actions.push({
      kind,
      team,
      ...(umaId === undefined ? {} : { umaId }),
      name: displayName,
      imageUrl: image.src,
      order: actions.length + 1
    });
  }

  return actions;
}

function findClosestDraftCard(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;

  while (current !== null && current.tagName !== 'BODY') {
    const text = normalizeText(current.textContent)?.toLowerCase() ?? '';

    if (
      text.includes('banned') ||
      text.includes('vetoed') ||
      current.className.toString().includes('aspect-square') ||
      current.className.toString().includes('piece-socket')
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function readUmaId(record: Record<string, unknown>): string | undefined {
  const umaId = readOptionalString(record.umaId)
    ?? readOptionalString(record.cardId)
    ?? readOptionalString(record.selectedUmaId)
    ?? readOptionalString(record.outfitId)
    ?? readOptionalNumber(record.umaId)?.toString()
    ?? readOptionalNumber(record.cardId)?.toString()
    ?? readOptionalNumber(record.selectedUmaId)?.toString()
    ?? readOptionalNumber(record.outfitId)?.toString();

  return umaId === undefined ? undefined : normalizeUmaOutfitId(umaId);
}

function readUmaActionKind(record: Record<string, unknown>, path: string[]): DraftUmaActionKind {
  const explicitKind = readOptionalString(record.kind) ?? readOptionalString(record.type);
  const normalizedKind = explicitKind?.toLowerCase();

  if (normalizedKind?.includes('veto') === true) {
    return 'veto';
  }

  if (normalizedKind?.includes('ban') === true) {
    return 'ban';
  }

  const pathText = path.join('.').toLowerCase();

  if (pathText.includes('veto')) {
    return 'veto';
  }

  if (pathText.includes('ban')) {
    return 'ban';
  }

  return 'pick';
}

function pathContainsDraftMapHint(path: string[]): boolean {
  const pathText = path.join('.').toLowerCase();

  return pathText.includes('map') || pathText.includes('race') || pathText.includes('course');
}

function parseTiebreakerMapText(value: string): DraftTiebreakerMap | undefined {
  const text = normalizeText(value.replace(/^tiebreaker\s*:\s*/i, ''));

  if (text === undefined) {
    return undefined;
  }

  const parenthesizedDetails = /^(.+?)\s*\((.+)\)$/.exec(text);

  if (parenthesizedDetails !== null) {
    const [, name, details] = parenthesizedDetails;

    if (name === undefined || details === undefined) {
      return { name: text };
    }

    return {
      name: name.trim(),
      details: details.trim()
    };
  }

  return { name: text };
}

function readTeamFromPath(path: string[]): TeamId | undefined {
  const pathText = path.join('.').toLowerCase();

  if (pathText.includes('team1')) {
    return 'team1';
  }

  if (pathText.includes('team2')) {
    return 'team2';
  }

  return undefined;
}

function compareOrderedDraftItems(
  left: { order?: number },
  right: { order?: number }
): number {
  return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
}

function compareElementsByPosition(left: HTMLElement, right: HTMLElement): number {
  const leftRect = left.getBoundingClientRect();
  const rightRect = right.getBoundingClientRect();
  const verticalDelta = leftRect.top - rightRect.top;

  if (Math.abs(verticalDelta) > 20) {
    return verticalDelta;
  }

  return leftRect.left - rightRect.left;
}

function readFirstHeading(element: HTMLElement): string | undefined {
  for (const heading of Array.from(element.querySelectorAll<HTMLHeadingElement>('h2, h3'))) {
    const text = normalizeText(heading.textContent);

    if (text !== undefined && !text.toLowerCase().includes('maps') && !text.toLowerCase().includes('umamusume')) {
      return text;
    }
  }

  return undefined;
}

function getTextLines(element: HTMLElement): string[] {
  const innerText = element.innerText || element.textContent || '';

  return innerText
    .split(/\n+/)
    .map((line: string) => normalizeText(line))
    .filter((line): line is string => line !== undefined);
}

function isDraftMapOrder(value: string): boolean {
  return /^\d+$/.test(value);
}

function isDraftCrossMark(value: string): boolean {
  return value === 'x' || value === 'X' || value === '\u00d7' || value === '\u2715' || value === '\u2716';
}

function extractUmaIdFromImageUrl(value: string): string | undefined {
  const umaId = /chara_stand_\d+_(\d+)\.webp/i.exec(value)?.[1];

  return umaId === undefined ? undefined : normalizeUmaOutfitId(umaId);
}

function normalizeText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalTeamId(value: unknown): TeamId | undefined {
  return typeof value === 'string' && TEAM_IDS.includes(value as TeamId) ? value as TeamId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
