import type {
  DraftMapSelection,
  DraftSnapshot,
  DraftTeamSnapshot,
  DraftUmaAction,
  DraftUmaActionKind,
  TeamId
} from '@umalytics/shared';
import { TEAM_IDS, getDraftSlots } from '../common/roster';

export const DRAFT_DETAIL_SEPARATOR = ' • ';

export type DraftStageKey = 'picks' | 'vetoes' | 'final-picks';

export interface DraftStage {
  key: DraftStageKey;
  label: string;
}

export function countDraftUmaKind(team: DraftTeamSnapshot | undefined, kind: DraftUmaActionKind): number {
  return team?.umas.filter((uma) => uma.kind === kind).length ?? 0;
}

export function getDraftInitialPickCount(rules: DraftSnapshot['rules'], totalPickSlots: number): number {
  return rules?.picks ?? Math.max(totalPickSlots - 1, 0);
}

/** The Races column holds one slot per map each team ends up racing on: the
 * maps they picked, minus the ones the opponent vetoed back out. */
export function getDraftRaceSlotCount(
  rules: DraftSnapshot['rules'],
  totalMapSlots: number,
  defaultMapVetoes: number
): number {
  const perTeamMapSlots = rules?.maps ?? totalMapSlots;
  const mapVetoesPerTeam = rules?.mapVetoes ?? defaultMapVetoes;
  return 2 * Math.max(perTeamMapSlots - mapVetoesPerTeam, 0);
}

export function isDraftStageComplete(
  teams: DraftSnapshot['teams'],
  kind: DraftUmaActionKind,
  requiredCount: number
): boolean {
  return TEAM_IDS.every((teamId) => countDraftUmaKind(teams[teamId], kind) >= requiredCount);
}

export function getDraftStages(initialPickCount: number): DraftStage[] {
  return [
    { key: 'picks', label: `Picks 1–${initialPickCount}` },
    { key: 'vetoes', label: 'Vetoes' },
    { key: 'final-picks', label: 'Final picks' }
  ];
}

export function getDraftStageIndex(snapshot: DraftSnapshot, initialPickCount: number): number {
  const vetoCount = snapshot.rules?.vetoes ?? 1;

  if (!isDraftStageComplete(snapshot.teams, 'pick', initialPickCount)) {
    return 0;
  }

  if (!isDraftStageComplete(snapshot.teams, 'veto', vetoCount)) {
    return 1;
  }

  return 2;
}

export function isDraftComplete(snapshot: DraftSnapshot, totalPickSlots: number): boolean {
  return isDraftStageComplete(snapshot.teams, 'pick', totalPickSlots);
}

export function formatDraftStatusText(
  snapshot: DraftSnapshot,
  stageIndex: number,
  totalPickSlots: number
): string | undefined {
  if (isDraftComplete(snapshot, totalPickSlots)) {
    return 'Draft complete';
  }

  if (snapshot.currentTeam === undefined) {
    return undefined;
  }

  const currentTeam = snapshot.teams[snapshot.currentTeam];
  const teamName = formatTeamName(currentTeam);

  if (stageIndex === 1) {
    return `${teamName} is vetoing an opponent's pick`;
  }

  const pickCount = countDraftUmaKind(currentTeam, 'pick');

  return `${teamName} is picking their ${formatOrdinal(pickCount + 1)} Uma`;
}

export function formatOrdinal(value: number): string {
  const remainder100 = value % 100;

  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function formatTeamName(team: DraftTeamSnapshot | undefined): string {
  return team?.name ?? team?.id ?? 'Unknown team';
}

export interface DraftRaceMapFields {
  name: string;
  details?: string;
  track?: string;
  distance?: number;
  surface?: string;
  variant?: string;
  season?: string;
  weather?: string;
  ground?: string;
}

export interface DraftRaceCard {
  n: number;
  team: TeamId | 'tiebreaker';
  tiebreaker: boolean;
  map: DraftRaceMapFields;
}

/** The picked-map race cards only, in draft order, numbered 1..totalMapSlots.
 * The tiebreaker and vetoed maps render separately: these first, then TB,
 * then a compact Vetoed section (see getDraftVetoedMaps). */
export function buildDraftRaceCards(
  teams: DraftSnapshot['teams'],
  totalMapSlots: number
): Array<DraftRaceCard | undefined> {
  const picked = TEAM_IDS.flatMap((teamId) =>
    teams[teamId].maps
      .filter((map): map is DraftMapSelection & { order: number } => map.status === 'selected' && map.order !== undefined)
      .map((map) => ({ map, team: teamId }))
  ).sort((left, right) => left.map.order - right.map.order);

  return getDraftSlots(picked, totalMapSlots).map((entry, index) =>
    entry === undefined ? undefined : { n: index + 1, team: entry.team, tiebreaker: false, map: entry.map }
  );
}

export interface DraftVetoedMap {
  team: TeamId;
  map: DraftRaceMapFields;
}

/** Vetoed maps, one row per map, credited to the team whose own list held it
 * (the team that picked it, per the same convention as Uma vetoes). */
export function getDraftVetoedMaps(teams: DraftSnapshot['teams']): DraftVetoedMap[] {
  return TEAM_IDS.flatMap((teamId) =>
    teams[teamId].maps
      .filter((map) => map.status === 'vetoed')
      .map((map) => ({ team: teamId, map }))
  );
}

export function formatRaceTrackName(map: DraftRaceMapFields): string {
  return map.track ?? map.name;
}

export function formatRaceDistance(distance: number | undefined): string | undefined {
  return distance === undefined ? undefined : `${distance}m`;
}

export function hasStructuredRaceModifiers(map: DraftRaceMapFields): boolean {
  return map.surface !== undefined || map.season !== undefined || map.weather !== undefined || map.ground !== undefined;
}

export function formatDraftMapDetails(map: DraftRaceMapFields): string | undefined {
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

export interface DraftModChip {
  label: string;
  bg: string;
  fg: string;
}

const DEFAULT_MOD_TONE: readonly [string, string] = ['#1f2738', '#9aa4b8'];

const SURFACE_TONE: Record<string, readonly [string, string]> = {
  turf: ['#13301f', '#8fe0b0'],
  dirt: ['#3a2410', '#e3b078']
};

const SEASON_TONE: Record<string, readonly [string, string]> = {
  spring: ['#3a1830', '#ff9fd0'],
  summer: ['#13301f', '#8fe0b0'],
  autumn: ['#3a2410', '#f0b070'],
  winter: ['#16304a', '#8fc8ff']
};

const WEATHER_TONE: Record<string, readonly [string, string]> = {
  sunny: ['#33280f', '#f0cd74'],
  cloudy: ['#232b3c', '#c6cdda'],
  rainy: ['#16243f', '#9cc2ff'],
  snowy: ['#12303a', '#8fe3f0']
};

const GROUND_TONE: Record<string, readonly [string, string]> = {
  good: ['#251f3d', '#c9b6ff'],
  firm: ['#13301f', '#8fe0b0'],
  soft: ['#3a2410', '#f0b070'],
  heavy: ['#3a1818', '#ff9f9f']
};

function buildModChip(tone: Record<string, readonly [string, string]>, value: string | undefined): DraftModChip | undefined {
  if (value === undefined) {
    return undefined;
  }

  const [bg, fg] = tone[value.toLowerCase()] ?? DEFAULT_MOD_TONE;

  return { label: value, bg, fg };
}

export function getDraftSurfaceChip(value: string | undefined): DraftModChip | undefined {
  return buildModChip(SURFACE_TONE, value);
}

export function getDraftSeasonChip(value: string | undefined): DraftModChip | undefined {
  return buildModChip(SEASON_TONE, value);
}

export function getDraftWeatherChip(value: string | undefined): DraftModChip | undefined {
  return buildModChip(WEATHER_TONE, value);
}

export function getDraftGroundChip(value: string | undefined): DraftModChip | undefined {
  return buildModChip(GROUND_TONE, value);
}

export type DraftWeatherIconKey = 'sunny' | 'cloudy' | 'rainy' | 'snowy';

const WEATHER_ICON_KEYS: readonly DraftWeatherIconKey[] = ['sunny', 'cloudy', 'rainy', 'snowy'];

export function getDraftWeatherIconKey(value: string | undefined): DraftWeatherIconKey | undefined {
  const normalized = value?.toLowerCase();

  return WEATHER_ICON_KEYS.find((key) => key === normalized);
}

export function formatDraftUmaKind(kind: DraftUmaAction['kind']): string {
  switch (kind) {
    case 'ban':
      return 'Ban';
    case 'veto':
      return 'Veto';
    case 'pick':
      return 'Pick';
  }
}
