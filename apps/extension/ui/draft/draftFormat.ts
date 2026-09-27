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
  tone: string;
}

const MOD_TONES = {
  surface: ['turf', 'dirt'],
  season: ['spring', 'summer', 'autumn', 'winter'],
  weather: ['sunny', 'cloudy', 'rainy', 'snowy'],
  ground: ['good', 'firm', 'soft', 'heavy']
} as const;

function buildModChip(kind: keyof typeof MOD_TONES, value: string | undefined): DraftModChip | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  const known = (MOD_TONES[kind] as readonly string[]).includes(normalized);
  return { label: value, tone: known ? `${kind}-${normalized}` : 'default' };
}

export function getDraftSurfaceChip(value: string | undefined): DraftModChip | undefined {
  return buildModChip('surface', value);
}

export function getDraftSeasonChip(value: string | undefined): DraftModChip | undefined {
  return buildModChip('season', value);
}

export function getDraftWeatherChip(value: string | undefined): DraftModChip | undefined {
  return buildModChip('weather', value);
}

export function getDraftGroundChip(value: string | undefined): DraftModChip | undefined {
  return buildModChip('ground', value);
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
