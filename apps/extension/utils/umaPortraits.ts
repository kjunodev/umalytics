import { releaseOrder } from './umaReleaseOrder';

const DEFAULT_PROFILE_ORIGIN = 'https://drafter.uma.guide';

const UMA_PORTRAIT_ID_OVERRIDES = new Map<string, string>([
  ['103502', '103516'], // Steampunk Winning Ticket
  ['105002', '105016'], // Steampunk Narita Taishin
  ['100702', '100730'], // Summer Gold Ship
  ['101303', '101330'], // Summer Mejiro McQueen
  ['100103', '100102'], // Commander Special Week
  ['101002', '101023'], // Camping Taiki Shuttle
  ['105902', '105923'], // Camping Mejiro Dober
  ['102202', '102226'], // Wedding Fine Motion
  ['103802', '103826'], // Wedding Curren Chan
  ['106002', '106050'], // Cheerleader Nice Nature
  ['106102', '106150'], // Cheerleader King Halo
  ['100502', '100520'], // Ballroom Fuji Kiseki
  ['102002', '102020'], // Ballroom Seiun Sky
  ['101502', '101510'], // New Year T.M. Opera O
  ['105202', '105210'], // New Year Haru Urara
  ['100602', '100646'], // Christmas Oguri Cap
  ['102302', '102346'], // Christmas Biwa Hayahide
  ['101702', '101743'], // Festival Symboli Rudolf
  ['104002', '104043'], // Festival Gold City
  ['103002', '103040'], // Halloween Rice Shower
  ['104502', '104540'], // Halloween Super Creek
  ['105602', '105623'], // Full Armor Matikanefukukitaru
  ['101902', '101940'], // Halloween Agnes Digital
  ['105802', '105840'], // Halloween Meisho Doto
  ['102102', '102143'], // Festival Tamamo Cross
  ['103402', '103443'], // Festival Inari One
  ['100802', '100846'], // Christmas Vodka
  ['100902', '100946'], // Christmas Daiwa Scarlet
  ['102702', '102713'], // Valentine Mejiro Ryan
  ['103102', '103113'], // Valentine Ines Fujin
  ['106902', '106920'], // Ballroom Sakura Chiyono O
  ['107102', '107120'], // Ballroom Mejiro Ardan
  ['100102', '100130'], // Summer Special Week
  ['100402', '100430'], // Summer Maruzensky
  ['100202', '100230'], // Summer Silence Suzuka
  ['103602', '103640'], // Halloween Air Shakur
  ['108302', '108340'], // Halloween Symboli Kris S
  ['100303', '100343'], // Festival Tokai Teio
  ['103902', '103943'], // Festival Kawakami Princess
  ['106402', '106446'], // Christmas Mejiro Palmer
  ['107402', '107446'], // Christmas Mejiro Bright
  ['103302', '103346'], // Christmas Admire Vega
  ['107702', '107746'], // Christmas Narita Top Road
  ['102403', '102440'], // Halloween Mayano Top Gun
  ['104202', '104240'], // Halloween Seeking the Pearl
  ['101102', '101116'], // Fantasy Grass Wonder
  ['101402', '101416'], // Fantasy El Condor Pasa
  ['101802', '101826'], // Wedding Air Groove
  ['102402', '102426'], // Wedding Mayano Top Gun
  ['103702', '103713'], // Valentine Eishin Flash
  ['102602', '102613'] // Valentine Mihono Bourbon
]);

const UMA_OUTFIT_ID_BY_PORTRAIT_ID = new Map(
  Array.from(UMA_PORTRAIT_ID_OVERRIDES, ([outfitId, portraitId]) => [portraitId, outfitId] as const)
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

  const portraitId = UMA_PORTRAIT_ID_OVERRIDES.get(umaId) ?? umaId;
  const charaId = portraitId.slice(0, 4);

  return new URL(`/uma/chara_stand_${charaId}_${portraitId}.webp`, origin).href;
}

export function normalizeUmaOutfitId(umaId: string): string {
  if (UMA_RELEASE_ENTRY_BY_OUTFIT_ID.has(umaId)) {
    return umaId;
  }

  return UMA_OUTFIT_ID_BY_PORTRAIT_ID.get(umaId) ?? umaId;
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
