import type {
  DraftBlessing,
  DraftBlessingBan,
  DraftBlessingMap,
  DraftMapRules,
  DraftUmaAction,
  TeamId
} from '@umalytics/shared';
import { normalizeUmaOutfitId } from '../umas/umaPortraits';

// Season 3 "Three Goddesses' Blessing" and per-pick running styles. Parsers are
// tolerant: unknown goddess or style values pass through as text, and Season 2
// data (which has none of these fields) yields undefined.

type BlessingRecord = Record<string, unknown>;
const blessingRecord = (value: unknown): BlessingRecord => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as BlessingRecord : {};
const blessingText = (value: unknown, max = 160): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
const blessingTeam = (value: unknown): TeamId | undefined => value === 'team1' || value === 'team2' ? value : undefined;
const blessingCount = (value: unknown): number | undefined => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 32 ? value : undefined;
const BLESSING_TEAMS = ['team1', 'team2'] as const;

function blessingMap(value: unknown): DraftBlessingMap | undefined {
  const raw = blessingRecord(value), conditions = blessingRecord(raw.conditions);
  const mapId = blessingText(raw.id), name = blessingText(raw.name) ?? blessingText(raw.track) ?? mapId;
  if (name === undefined) return undefined;
  const distance = typeof raw.distance === 'number' && Number.isFinite(raw.distance) ? raw.distance : undefined;
  const fields = { mapId, track: blessingText(raw.track), distance, surface: blessingText(raw.surface, 40), variant: blessingText(raw.variant, 40),
    direction: blessingText(raw.direction, 40), season: blessingText(conditions.season, 40), weather: blessingText(conditions.weather, 40), ground: blessingText(conditions.ground, 40) };
  return { name, ...Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== undefined)) };
}

export function parseBlessing(value: unknown): DraftBlessing | undefined {
  const raw = blessingRecord(value), goddess = blessingText(raw.goddess, 60)?.toLowerCase();
  if (goddess === undefined) return undefined;
  const blessing: DraftBlessing = { goddess };
  const status = blessingText(raw.status, 40), category = blessingText(raw.arabianCategory, 24)?.toLowerCase(), selected = blessingText(raw.selectedMapId);
  if (status) blessing.status = status;
  if (category) blessing.arabianCategory = category;
  if (selected) blessing.selectedMapId = selected;
  if (Array.isArray(raw.candidates)) {
    const candidates = raw.candidates.slice(0, 6).flatMap(candidate => blessingMap(candidate) ?? []);
    if (candidates.length) blessing.candidates = candidates;
  }
  const bans: Partial<Record<TeamId, DraftBlessingBan>> = {};
  for (const id of BLESSING_TEAMS) {
    const ban = blessingRecord(blessingRecord(raw.bans)[id]), mapId = blessingText(ban.mapId);
    if (mapId || typeof ban.automatic === 'boolean') bans[id] = { ...(mapId ? { mapId } : {}), ...(typeof ban.automatic === 'boolean' ? { automatic: ban.automatic } : {}) };
  }
  if (Object.keys(bans).length) blessing.bans = bans;
  if (Array.isArray(raw.lockedTeams)) {
    const locked = BLESSING_TEAMS.filter(id => (raw.lockedTeams as unknown[]).includes(id));
    if (locked.length) blessing.lockedTeams = [...locked];
  }
  return blessing;
}

/** Map limits from a draft rules record (`rules.map`). Arabian's raised limit
 * arrives as the effective `maxPerDistanceCategoryOverrides`. */
export function parseMapRules(rules: unknown): DraftMapRules | undefined {
  const map = blessingRecord(blessingRecord(rules).map);
  const overrides = Object.fromEntries(Object.entries(blessingRecord(map.maxPerDistanceCategoryOverrides)).slice(0, 8)
    .flatMap(([key, limit]) => /^[a-z][a-z-]{0,19}$/i.test(key) && blessingCount(limit) !== undefined ? [[key.toLowerCase(), limit as number]] : []));
  const result: DraftMapRules = {};
  if (blessingCount(map.maxDirtPerTeam) !== undefined) result.maxDirtPerTeam = blessingCount(map.maxDirtPerTeam);
  if (blessingCount(map.maxPerDistanceCategory) !== undefined) result.maxPerDistanceCategory = blessingCount(map.maxPerDistanceCategory);
  if (Object.keys(overrides).length) result.distanceCategoryOverrides = overrides;
  return Object.keys(result).length ? result : undefined;
}

export function normalizeRunningStyle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const style = value.trim().toLowerCase();
  return /^[a-z][a-z -]{0,23}$/.test(style) ? style : undefined;
}

export interface RunningStyleAssignment { team: TeamId; umaId: string; runningStyle: string }

/** Reads `{ team, selectedUmaId, runningStyle }` rows. Earlier sources win, so
 * pass the saved assignments before the report participants. No player
 * identity is kept: only which Uma on which side runs which style. */
export function parseStyleAssignments(...sources: unknown[]): RunningStyleAssignment[] {
  const found = new Map<string, RunningStyleAssignment>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const entry of source.slice(0, 32)) {
      const raw = blessingRecord(entry), side = blessingTeam(raw.team) ?? blessingTeam(raw.finalTeam), runningStyle = normalizeRunningStyle(raw.runningStyle);
      const id = typeof raw.selectedUmaId === 'string' || typeof raw.selectedUmaId === 'number' ? String(raw.selectedUmaId) : '';
      if (!side || !runningStyle || !/^\d{4,6}$/.test(id)) continue;
      const umaId = normalizeUmaOutfitId(id), key = `${side}:${umaId}`;
      if (!found.has(key)) found.set(key, { team: side, umaId, runningStyle });
    }
  }
  return [...found.values()];
}

/** Sets runningStyle on the matching picks. Picks without an assignment keep none. */
export function applyRunningStyles(teams: Record<TeamId, { umas: DraftUmaAction[] }>, assignments: RunningStyleAssignment[]): void {
  for (const assignment of assignments) {
    const pick = teams[assignment.team]?.umas.find(uma => uma.kind === 'pick' && uma.umaId === assignment.umaId && uma.runningStyle === undefined);
    if (pick) pick.runningStyle = assignment.runningStyle;
  }
}

// ---- presentation ----

const GODDESS_NAMES: Record<string, string> = { 'godolphin-barb': 'Godolphin Barb', 'darley-arabian': 'Darley Arabian', 'byerley-turk': 'Byerley Turk' };
const blessingTitleCase = (value: string) => value.split(/[-\s]+/).filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join(' ');

export const BARB_GROUND = 'Firm';
export const BARB_WEATHER = 'Sunny';
export function isGodolphinBarb(blessing: DraftBlessing | undefined): boolean {
  return blessing?.goddess === 'godolphin-barb';
}

export function goddessName(goddess: string): string {
  return GODDESS_NAMES[goddess] ?? blessingTitleCase(goddess);
}

export function distanceCategoryLabel(category: string): string {
  return blessingTitleCase(category);
}

/** The one-line chip text, for example "Darley Arabian · Long limit 3". */
export function describeBlessing(blessing: DraftBlessing, mapRules?: DraftMapRules): { name: string; effect?: string; label: string } {
  const name = goddessName(blessing.goddess);
  let effect: string | undefined;
  if (blessing.goddess === 'godolphin-barb') effect = `${BARB_WEATHER} / ${BARB_GROUND}`;
  else if (blessing.goddess === 'darley-arabian' && blessing.arabianCategory) {
    const limit = mapRules?.distanceCategoryOverrides?.[blessing.arabianCategory];
    effect = `${distanceCategoryLabel(blessing.arabianCategory)} limit ${limit ?? 'raised'}`;
  } else if (blessing.goddess === 'byerley-turk') effect = 'sealed tiebreaker bans';
  return { name, ...(effect ? { effect } : {}), label: effect ? `${name} · ${effect}` : name };
}

/** "Dirt 3 per team · 2 per distance (Long 3)"; undefined when no limits were shared. */
export function formatMapLimits(mapRules: DraftMapRules | undefined): string | undefined {
  if (!mapRules) return undefined;
  const overrides = Object.entries(mapRules.distanceCategoryOverrides ?? {}).map(([category, limit]) => `${distanceCategoryLabel(category)} ${limit}`);
  const distance = mapRules.maxPerDistanceCategory === undefined ? undefined
    : `${mapRules.maxPerDistanceCategory} per distance${overrides.length ? ` (${overrides.join(', ')})` : ''}`;
  const parts = [mapRules.maxDirtPerTeam === undefined ? undefined : `Dirt ${mapRules.maxDirtPerTeam} per team`,
    distance ?? (overrides.length ? `Distance ${overrides.join(', ')}` : undefined)].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

const STYLE_ORDER = ['runaway', 'front', 'pace', 'late', 'end'];
const STYLE_LABELS: Record<string, string> = { front: 'Front', pace: 'Pace', late: 'Late', end: 'End', runaway: 'Runaway' };
export function runningStyleLabel(style: string): string {
  return STYLE_LABELS[style] ?? blessingTitleCase(style);
}

export interface StyleCount { style: string; label: string; count: number }

/** Picks per running style, front of the pack first, then unknown styles. */
export function runningStyleComposition(umas: DraftUmaAction[]): StyleCount[] {
  const counts = new Map<string, number>();
  for (const uma of umas) if (uma.kind === 'pick' && uma.runningStyle) counts.set(uma.runningStyle, (counts.get(uma.runningStyle) ?? 0) + 1);
  const rank = (style: string) => STYLE_ORDER.includes(style) ? STYLE_ORDER.indexOf(style) : STYLE_ORDER.length;
  return [...counts].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([style, total]) => ({ style, label: runningStyleLabel(style), count: total }));
}

/** "Runaway · Front · 2 Pace · End" */
export function formatStyleComposition(items: StyleCount[]): string {
  return items.map(item => item.count > 1 ? `${item.count} ${item.label}` : item.label).join(' · ');
}

export interface TiebreakerCandidate { map: DraftBlessingMap; bannedBy: TeamId[]; automatic: boolean; selected: boolean }

/** Byerley Turk: each candidate with the teams that banned it and whether it became the tiebreaker. */
export function tiebreakerCandidates(blessing: DraftBlessing | undefined): TiebreakerCandidate[] {
  return (blessing?.candidates ?? []).map(map => {
    const bannedBy = BLESSING_TEAMS.filter(id => map.mapId !== undefined && blessing?.bans?.[id]?.mapId === map.mapId);
    return { map, bannedBy: [...bannedBy], automatic: bannedBy.some(id => blessing?.bans?.[id]?.automatic === true),
      selected: map.mapId !== undefined && blessing?.selectedMapId === map.mapId };
  });
}
