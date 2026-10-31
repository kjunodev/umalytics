import type { DraftSnapshot, DraftMapSelection, DraftTiebreakerMap } from '@umalytics/shared';
import { groundNames, weatherNames, seasonNames, type Catalog, type Course, type RaceSelection, type StaminaResult } from './staminaTypes';

export interface DraftRace { label: string; raw: string; race?: RaceSelection; course?: Course; reason?: string; choiceKey?: string }
export type CourseChoices = Record<string, Record<string, string>>;
const normalized = (text: string | undefined) => (text ?? '').trim().toLowerCase();
const track = (text: string | undefined) => normalized(text) === 'oi' ? 'ooi' : normalized(text);
function resolve(map: DraftMapSelection | DraftTiebreakerMap, catalog: Catalog, choices: Record<string, string> = {}): DraftRace {
  const raw = [map.name, map.details, map.track, map.distance, map.surface, map.variant, map.season, map.weather, map.ground].filter(v => v !== undefined && v !== '').join(' · ');
  const id = 'mapId' in map ? map.mapId : undefined;
  const choiceKey = id ? `id:${id}` : JSON.stringify([map.track ?? map.name, map.distance, map.surface, map.variant]);
  let course = id ? catalog.courses.find(c => c.id === id) : undefined;
  if (!course && map.track && map.distance && map.surface) {
    const matches = catalog.courses.filter(c => track(c.track_name) === track(map.track) && c.distance === map.distance
      && (c.surface === 1 ? 'turf' : 'dirt') === normalized(map.surface) && normalized(c.variant ?? undefined) === normalized(map.variant));
    if (matches.length === 1) course = matches[0];
  }
  // Only an explicit choice can resolve a course absent from the pool metadata.
  if (!course) course = catalog.courses.find(c => c.id === choices[choiceKey]);
  const condition = (value: string | undefined, names: string[]) => names.findIndex(name => normalized(name) === normalized(value)) + 1;
  const ground_condition = condition(map.ground, groundNames), weather = condition(map.weather, weatherNames);
  const season = condition(normalized(map.season) === 'autumn' ? 'Fall' : map.season, seasonNames);
  if (!course) return { label: 'Unknown course', raw, choiceKey, reason: 'No exact course in the drafter pool' };
  if (!ground_condition || !weather || !season) return { label: `${course.track_name} ${course.distance}`, raw, course, reason: 'Unknown or missing conditions' };
  if (course.unavailable_reason) return { label: `${course.track_name} ${course.distance}`, raw, course, reason: course.unavailable_reason };
  return { label: `${course.track_name} ${course.distance} · ${course.surface === 1 ? 'Turf' : 'Dirt'}${course.variant ? ` · ${course.variant}` : ''}`, raw, course,
    race: { map_id: course.id, ground_condition, weather, season } };
}
export function draftRaces(snapshot: DraftSnapshot | undefined, catalog: Catalog, choices: CourseChoices = {}): DraftRace[] {
  if (!snapshot) return [];
  const maps = (['team1', 'team2'] as const).flatMap(team => snapshot.teams[team].maps.filter(m => m.status === 'selected')).sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
  const roomChoices = snapshot.matchCode ? choices[snapshot.matchCode] ?? {} : {};
  return [...maps.map(map => resolve(map, catalog, roomChoices)), ...(snapshot.tiebreakerMap ? [resolve(snapshot.tiebreakerMap, catalog, roomChoices)] : [])].slice(0, 7);
}
export function draftFingerprint(snapshot: DraftSnapshot | undefined, races: DraftRace[]): string {
  return JSON.stringify([snapshot?.matchCode ?? null, races.map(r => [r.race ?? null, r.course?.id ?? null, r.race ? null : r.raw, r.reason ?? null])]);
}
export function passes(result: StaminaResult): boolean {
  return result.thresholds.joint !== null && result.current.stamina >= result.thresholds.joint && result.current.joint_percent >= result.input.target;
}
