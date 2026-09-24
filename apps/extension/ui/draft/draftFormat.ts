import type { DraftSnapshot, DraftTeamSnapshot, DraftUmaAction } from '@umalytics/shared';

export const DRAFT_DETAIL_SEPARATOR = ' • ';

export function formatDraftPhase(phase: string): string {
  return phase
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

export function formatDraftMapTitle(map: DraftTeamSnapshot['maps'][number]): string {
  const details = formatDraftMapDetails(map);

  return details === undefined ? map.name : `${map.name}${DRAFT_DETAIL_SEPARATOR}${details}`;
}

export function formatDraftMapDetails(map: DraftTeamSnapshot['maps'][number]): string | undefined {
  if (map.details === undefined) {
    return undefined;
  }

  const details = map.details
    .replace(/\s*[-–—]\s*[xX×✕✖]\s*$/u, '')
    .replace(/\s*[xX×✕✖]\s*$/u, '')
    .split(/\s*(?:[-–—]|•)\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(DRAFT_DETAIL_SEPARATOR);

  return details.length === 0 ? undefined : details;
}

export function formatTiebreakerMap(map: NonNullable<DraftSnapshot['tiebreakerMap']>): string {
  const parsed = parseTiebreakerMapParts(map);

  if (parsed === undefined) {
    return map.details === undefined ? map.name : `${map.name} (${map.details})`;
  }

  const details = parsed.details
    .map(formatTiebreakerDetailToken)
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(DRAFT_DETAIL_SEPARATOR);

  if (details.length === 0) {
    return parsed.name;
  }

  return `${parsed.name}${DRAFT_DETAIL_SEPARATOR}${details}`;
}

export function parseTiebreakerMapParts(
  map: NonNullable<DraftSnapshot['tiebreakerMap']>
): { name: string; details: string[] } | undefined {
  const combinedText = (map.details === undefined ? map.name : `${map.name} - ${map.details}`)
    .replace(/ /g, ' ')
    .trim();
  const compactTextMatch = /^(.+?)\s*\((\d{3,4})m?\s+([^)]+)\)\s*([A-Za-z\s]+)$/.exec(combinedText);

  if (compactTextMatch !== null) {
    const [, name, distance, surface, trailingDetails] = compactTextMatch;

    if (name !== undefined && distance !== undefined && surface !== undefined) {
      return {
        name: name.trim(),
        details: [
          distance,
          surface.trim(),
          ...splitCompactTiebreakerDetails(trailingDetails ?? '')
        ]
      };
    }
  }

  const [rawName, ...rawDetails] = combinedText
    .split(/\s*(?:[-–—]|•)\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (rawName === undefined || rawDetails.length === 0) {
    return undefined;
  }

  return {
    name: rawName,
    details: rawDetails
  };
}

export function formatTiebreakerDetailToken(value: string): string {
  return value.replace(/^(\d{3,4})m?$/i, '$1m');
}

export function splitCompactTiebreakerDetails(value: string): string[] {
  return Array.from(
    value.matchAll(/Right|Left|Straight|Inner|Outer|Spring|Summer|Fall|Winter|Firm|Good|Soft|Heavy|Sunny|Cloudy|Rainy|Snowy/gi),
    ([token]) => token
  );
}

export function formatDraftUmaKind(kind: DraftUmaAction['kind']): string {
  switch (kind) {
    case 'ban':
      return 'Banned';
    case 'veto':
      return 'Vetoed';
    case 'pick':
      return 'Picked';
  }
}

export function formatTeamName(team: DraftTeamSnapshot | undefined): string {
  return team?.name ?? team?.id ?? 'Unknown team';
}
