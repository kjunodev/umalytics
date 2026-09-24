import type { PlayerProfileSummary, PlayerStatsScope } from '@umalytics/shared';

export function formatRank(profile: PlayerProfileSummary | undefined, isLoading: boolean): string {
  if (profile?.rank !== undefined && profile.rank !== null) {
    return `#${profile.rank}`;
  }

  return isLoading ? 'Loading profile' : 'Unranked';
}

export function formatRecord(profile: PlayerProfileSummary | undefined): string {
  if (profile?.wins === undefined || profile.losses === undefined) {
    return '-';
  }

  if (profile.wins === null || profile.losses === null) {
    return '-';
  }

  return `${profile.wins}-${profile.losses}`;
}

export function formatPercent(value: number | null | undefined): string {
  return value === undefined || value === null ? '-' : `${(value * 100).toFixed(0)}%`;
}

export function formatDecimal(value: number | null | undefined): string {
  return value === undefined || value === null ? '-' : value.toFixed(1);
}

export function formatNumber(value: number | null | undefined): string {
  return value === undefined || value === null ? '-' : value.toLocaleString();
}

export function normalizeUmaNameForLookup(name: unknown): string {
  if (typeof name !== 'string') {
    return '';
  }

  return name
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSearchText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatStatsScopeShortLabel(statsScope: PlayerStatsScope): string {
  return statsScope === 'currentSeason' ? 'Seasonal' : 'All-time';
}

export function formatRelativeAge(timestamp: number, now: number): string {
  const ageSeconds = Math.max(Math.floor((now - timestamp) / 1000), 0);

  if (ageSeconds < 10) {
    return 'just now';
  }

  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`;
  }

  const ageMinutes = Math.floor(ageSeconds / 60);

  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`;
  }

  const ageHours = Math.floor(ageMinutes / 60);

  return `${ageHours}h ago`;
}
