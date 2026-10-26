import { UMA_PORTRAIT_ID_BY_OUTFIT_ID } from './umaPortraitMap';
import { releaseOrder } from './umaReleaseOrder';

const DEFAULT_PROFILE_ORIGIN = 'https://drafter.uma.guide';

const UMA_OUTFIT_ID_BY_PORTRAIT_ID = new Map(
  Array.from(UMA_PORTRAIT_ID_BY_OUTFIT_ID, ([outfitId, portraitId]) => [portraitId, outfitId] as const)
);

const UMA_RELEASE_ENTRY_BY_OUTFIT_ID = new Map(
  releaseOrder.map((entry) => [entry.outfitId, entry] as const)
);

export function getUmaPortraitUrl(
  umaId: string,
  origin = DEFAULT_PROFILE_ORIGIN
): string | undefined {
  if (!/^\d{6}$/.test(umaId)) {
    return undefined;
  }

  const portraitId = UMA_PORTRAIT_ID_BY_OUTFIT_ID.get(umaId) ?? umaId;
  const charaId = portraitId.slice(0, 4);

  return new URL(`/uma/chara_stand_${charaId}_${portraitId}.webp`, origin).href;
}

// For IDs read from data fields (room state, stats, records), which are outfit IDs.
export function normalizeUmaOutfitId(umaId: string): string {
  if (UMA_RELEASE_ENTRY_BY_OUTFIT_ID.has(umaId)) {
    return umaId;
  }

  return UMA_OUTFIT_ID_BY_PORTRAIT_ID.get(umaId) ?? umaId;
}

// For IDs parsed from an image URL, which are portrait IDs. Some portrait IDs
// are also outfit IDs of another Uma, so the reverse map must win over identity.
export function normalizeUmaPortraitId(portraitId: string): string {
  return UMA_OUTFIT_ID_BY_PORTRAIT_ID.get(portraitId) ?? portraitId;
}

export function isKnownUmaOutfitId(umaId: string): boolean {
  return UMA_RELEASE_ENTRY_BY_OUTFIT_ID.has(umaId);
}

export function getUmaDisplayName(umaId: string, fallbackName?: string): string {
  const releaseEntry = UMA_RELEASE_ENTRY_BY_OUTFIT_ID.get(umaId)
    ?? UMA_RELEASE_ENTRY_BY_OUTFIT_ID.get(normalizeUmaOutfitId(umaId));

  if (releaseEntry === undefined) {
    return fallbackName ?? umaId;
  }

  const variant = releaseEntry.variant.trim();

  if (variant.length === 0) {
    return releaseEntry.name;
  }

  return `${variant} ${releaseEntry.name}`;
}

export function isHashedUmaAssetUrl(imageUrl: string | undefined): boolean {
  return imageUrl !== undefined && /\/assets\/\d{6}-[^/]+\.webp(?:[?#].*)?$/.test(imageUrl);
}

// Drafter records carry root-relative image URLs; only drafter-hosted images are kept.
export function resolveDrafterImageUrl(
  imageUrl: string | undefined,
  origin = DEFAULT_PROFILE_ORIGIN
): string | undefined {
  if (imageUrl === undefined || imageUrl.trim() === '') {
    return undefined;
  }

  try {
    const url = new URL(imageUrl.trim(), origin);

    return url.origin === new URL(origin).origin ? url.href : undefined;
  } catch {
    return undefined;
  }
}
