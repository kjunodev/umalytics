import type { TeamId } from '@umalytics/shared';
import { TEAM_IDS } from './teams';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

export function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readOptionalTeamId(value: unknown): TeamId | undefined {
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

export function isTeamId(value: string): value is TeamId {
  return TEAM_IDS.includes(value as TeamId);
}
