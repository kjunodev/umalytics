import type { DraftUmaAction, PlayerProfileSummary, PlayerStatsScope, PlayerTopUmaSummary, PrematchPlayer, TeamId } from '@umalytics/shared';
import { releaseOrder } from '../../umas/umaReleaseOrder';
import {
  getUmaDisplayName,
  getUmaPortraitUrl,
  isHashedUmaAssetUrl,
  isKnownUmaOutfitId,
  normalizeUmaOutfitId
} from '../../umas/umaPortraits';
import { normalizeSearchText, normalizeUmaNameForLookup } from '../common/format';
import { getDisplayedProfileStats } from '../player/playerProfileDisplay';

export type UmaCatalogSortMode = 'releaseOrder' | 'lobbyHits' | 'alphabetical';

export type UmaCatalogHitScope = 'all' | TeamId;

export type UmaCatalogSortOption = { value: UmaCatalogSortMode; label: string };

export type UmaCatalogHitScopeOption = { value: UmaCatalogHitScope; label: string };

export interface UmaExperienceEntry {
  discordId: string;
  displayName: string;
  uma: PlayerTopUmaSummary;
}

export interface UmaCatalogOption {
  umaId: string;
  name: string;
  imageUrl: string | undefined;
  order: number | undefined;
}

export const RELEASE_VARIANT_BY_OUTFIT_ID = new Map(
  releaseOrder.map((entry) => [entry.outfitId, entry.variant.trim()] as const)
);

export function getUmaCatalogOptions(
  profiles: Record<string, PlayerProfileSummary>,
  statsScope: PlayerStatsScope
): UmaCatalogOption[] {
  const catalog = new Map<string, UmaCatalogOption>();

  releaseOrder.forEach((entry, index) => {
    const umaId = entry.outfitId;

    catalog.set(umaId, {
      umaId,
      name: getUmaDisplayName(umaId, entry.name),
      imageUrl: getUmaPortraitUrl(umaId),
      order: index + 1
    });
  });

  for (const profile of Object.values(profiles)) {
    const displayedProfile = getDisplayedProfileStats(profile, statsScope);
    const umas = displayedProfile?.allUmas ?? profile.allUmas ?? [];

    for (const uma of umas) {
      if (!isDisplayableUmaCatalogEntry(uma)) {
        continue;
      }

      const umaId = getUmaCatalogKey(uma.umaId, uma.name);
      const current = catalog.get(umaId);
      const profileImageUrl =
        uma.imageUrl !== undefined && !isHashedUmaAssetUrl(uma.imageUrl) ? uma.imageUrl : undefined;

      catalog.set(umaId, {
        umaId,
        name: getUmaDisplayName(umaId, uma.name),
        imageUrl: current?.imageUrl ?? profileImageUrl ?? getUmaPortraitUrl(umaId),
        order: current?.order
      });
    }
  }

  return Array.from(catalog.values());
}

export function sortUmaCatalogOptions(
  catalog: UmaCatalogOption[],
  sortMode: UmaCatalogSortMode,
  historyCounts: Map<string, number>
): UmaCatalogOption[] {
  return [...catalog].sort((left, right) => {
    if (sortMode === 'lobbyHits') {
      const hitDelta = (historyCounts.get(right.umaId) ?? 0) - (historyCounts.get(left.umaId) ?? 0);

      if (hitDelta !== 0) {
        return hitDelta;
      }
    }

    if (sortMode === 'alphabetical') {
      return compareUmaByName(left, right);
    }

    return compareUmaByReleaseOrder(left, right);
  });
}

export function compareUmaByReleaseOrder(left: UmaCatalogOption, right: UmaCatalogOption): number {
  const leftOrder = left.order ?? Number.NEGATIVE_INFINITY;
  const rightOrder = right.order ?? Number.NEGATIVE_INFINITY;
  const orderDelta = rightOrder - leftOrder;

  if (orderDelta !== 0) {
    return orderDelta;
  }

  return compareUmaByName(left, right);
}

export function compareUmaByName(left: UmaCatalogOption, right: UmaCatalogOption): number {
  const nameDelta = left.name.localeCompare(right.name);

  if (nameDelta !== 0) {
    return nameDelta;
  }

  return left.umaId.localeCompare(right.umaId);
}

export function getUmaCatalogKey(umaId: string | undefined, name: string): string {
  return umaId === undefined ? normalizeSearchText(name) : umaId;
}

export function isDisplayableUmaCatalogEntry(uma: PlayerTopUmaSummary): boolean {
  const normalizedName = normalizeSearchText(uma.name);
  const normalizedUmaId = typeof uma.umaId === 'string' ? uma.umaId.trim().toLowerCase() : '';

  return (
    normalizedName.length > 0 &&
    !['unknown', 'undefined', 'null', '?', 'u'].includes(normalizedName) &&
    !['unknown', 'undefined', 'null', '?', 'u'].includes(normalizedUmaId)
  );
}

export function filterUmaCatalogOptions(
  catalog: UmaCatalogOption[],
  searchQuery: string
): UmaCatalogOption[] {
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (normalizedQuery.length === 0) {
    return catalog;
  }

  return catalog.filter((uma) => normalizeSearchText(uma.name).includes(normalizedQuery));
}

export function getUmaHistoryCounts(
  catalog: UmaCatalogOption[],
  rosterPlayers: PrematchPlayer[],
  profiles: Record<string, PlayerProfileSummary>,
  statsScope: PlayerStatsScope
): Map<string, number> {
  return new Map(
    catalog.map((uma) => [
      uma.umaId,
      getUmaExperience(getUmaCatalogAction(uma), rosterPlayers, profiles, statsScope).length
    ])
  );
}

export function getUmaCatalogAction(uma: UmaCatalogOption): DraftUmaAction {
  return {
    kind: 'pick',
    team: 'team1',
    name: uma.name,
    umaId: uma.umaId
  };
}

export function getUmaExperience(
  action: DraftUmaAction,
  rosterPlayers: PrematchPlayer[],
  profiles: Record<string, PlayerProfileSummary>,
  statsScope: PlayerStatsScope
): UmaExperienceEntry[] {
  const seenPlayers = new Set<string>();
  return rosterPlayers
    .filter((player) => {
      if (seenPlayers.has(player.discordId)) return false;
      seenPlayers.add(player.discordId);
      return true;
    })
    .map((player) => {
      const profile = profiles[player.discordId];
      const uma = findScopedUmaEntry(action, profile, statsScope);

      if (uma === undefined) {
        return null;
      }

      return {
        discordId: player.discordId,
        displayName: profile?.displayName ?? player.displayName,
        uma
      } satisfies UmaExperienceEntry;
    })
    .filter((entry): entry is UmaExperienceEntry => entry !== null)
    .sort((left, right) => {
      const matchesDelta = right.uma.matches - left.uma.matches;

      if (matchesDelta !== 0) {
        return matchesDelta;
      }

      return (right.uma.pointsPerGame ?? 0) - (left.uma.pointsPerGame ?? 0);
    });
}

export function findScopedUmaEntry(
  action: DraftUmaAction,
  profile: PlayerProfileSummary | undefined,
  statsScope: PlayerStatsScope
): PlayerTopUmaSummary | undefined {
  const scopedStats = statsScope === 'allTime' ? profile?.allTimeStats : profile?.currentSeasonStats;
  const umas = scopedStats?.allUmas ?? profile?.allUmas ?? [];
  const nameMatch = findScopedUmaEntryByName(action, umas);

  if (action.umaId !== undefined) {
    const exactMatch = umas.find((uma) => uma.umaId === action.umaId);

    if (exactMatch !== undefined) {
      return exactMatch;
    }

    if (!isKnownUmaOutfitId(action.umaId)) {
      const normalizedUmaId = normalizeUmaOutfitId(action.umaId);
      const normalizedMatch = normalizedUmaId === action.umaId
        ? undefined
        : umas.find((uma) => uma.umaId === normalizedUmaId);

      if (normalizedMatch !== undefined) {
        return normalizedMatch;
      }
    }

    if (canUseUmaNameFallback(action)) {
      return nameMatch;
    }

    return undefined;
  }

  return nameMatch;
}

export function findScopedUmaEntryByName(
  action: DraftUmaAction,
  umas: PlayerTopUmaSummary[]
): PlayerTopUmaSummary | undefined {
  const normalizedActionName = normalizeUmaNameForLookup(action.name);
  return umas.find((uma) => normalizeUmaNameForLookup(uma.name) === normalizedActionName);
}

export function canUseUmaNameFallback(action: DraftUmaAction): boolean {
  if (action.umaId === undefined) {
    return true;
  }

  if (!isKnownUmaOutfitId(action.umaId)) {
    return true;
  }

  return (RELEASE_VARIANT_BY_OUTFIT_ID.get(action.umaId) ?? '').length === 0;
}

// Aggregate published Uma summaries only; match-history pages are never inputs.
export function summarizeUmaExperience(experience: UmaExperienceEntry[]): {
  games: number; winRate: number | null; pointsPerGame: number | null;
} {
  const played = experience.filter(({ uma }) => uma.matches > 0);
  const games = played.reduce((total, { uma }) => total + uma.matches, 0);
  const winsKnown = played.every(({ uma }) => uma.winRate !== null);
  const pointsKnown = played.every(({ uma }) => uma.pointsPerGame !== null);
  return {
    games,
    winRate: games > 0 && winsKnown
      ? played.reduce((total, { uma }) => total + uma.wins, 0) / games : null,
    pointsPerGame: games > 0 && pointsKnown
      ? played.reduce((total, { uma }) => total + uma.points, 0) / games : null
  };
}
