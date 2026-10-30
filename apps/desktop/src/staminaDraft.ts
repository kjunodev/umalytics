import type { DraftSnapshot, DraftMapSelection, DraftTiebreakerMap } from '@umalytics/shared';
import { groundNames, weatherNames, seasonNames, type Catalog, type Course, type RaceSelection, type StaminaResult } from './staminaTypes';

export interface DraftRace { label: string; raw: string; race?: RaceSelection; course?: Course; reason?: string }
const normalized = (text: string | undefined) => (text ?? '').trim().toLowerCase();
const track = (text: string | undefined) => normalized(text) === 'oi' ? 'ooi' : normalized(text);
function resolve(map: DraftMapSelection | DraftTiebreakerMap, catalog: Catalog): DraftRace {
  const raw = [map.name, map.details, map.track, map.distance, map.surface, map.variant, map.season, map.weather, map.ground].filter(v => v !== undefined && v !== '').join(' · ');
  const id = 'mapId' in map ? map.mapId : undefined;
  let course = id ? catalog.courses.find(c => c.id === id) : undefined;
  if (!course && map.track && map.distance && map.surface) {
    const matches = catalog.courses.filter(c => track(c.track_name) === track(map.track) && c.distance === map.distance
      && (c.surface === 1 ? 'turf' : 'dirt') === normalized(map.surface) && normalized(c.variant ?? undefined) === normalized(map.variant));
    if (matches.length === 1) course = matches[0];
  }
  const condition = (value: string | undefined, names: string[]) => names.findIndex(name => normalized(name) === normalized(value)) + 1;
  const ground_condition = condition(map.ground, groundNames), weather = condition(map.weather, weatherNames);
  const season = condition(normalized(map.season) === 'autumn' ? 'Fall' : map.season, seasonNames);
  if (!course) return { label: 'Unknown course', raw, reason: 'No exact course in the drafter pool' };
  if (!ground_condition || !weather || !season) return { label: `${course.track_name} ${course.distance}`, raw, course, reason: 'Unknown or missing conditions' };
  if (course.unavailable_reason) return { label: `${course.track_name} ${course.distance}`, raw, course, reason: course.unavailable_reason };
  return { label: `${course.track_name} ${course.distance} · ${course.surface === 1 ? 'Turf' : 'Dirt'}${course.variant ? ` · ${course.variant}` : ''}`, raw, course,
    race: { map_id: course.id, ground_condition, weather, season } };
}
export function draftRaces(snapshot: DraftSnapshot | undefined, catalog: Catalog): DraftRace[] {
  if (!snapshot) return [];
  const maps = (['team1', 'team2'] as const).flatMap(team => snapshot.teams[team].maps.filter(m => m.status === 'selected')).sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
  return [...maps.map(map => resolve(map, catalog)), ...(snapshot.tiebreakerMap ? [resolve(snapshot.tiebreakerMap, catalog)] : [])].slice(0, 7);
}
export function draftFingerprint(snapshot: DraftSnapshot | undefined, races: DraftRace[]): string {
  return JSON.stringify([snapshot?.matchCode ?? null, races.map(r => [r.race ?? null, r.course?.id ?? null, r.race ? null : r.raw, r.reason ?? null])]);
}
export function passes(result: StaminaResult): boolean {
  return result.thresholds.joint !== null && result.current.stamina >= result.thresholds.joint && result.current.joint_percent >= result.input.target;
}
