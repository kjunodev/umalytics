export interface Course {
  id: string; track_name: string; distance: number; surface: number; direction: number;
  variant: string | null; course_set_id: number; race_instance_id: number;
  race_id: number; grade: number; time: number; month: number; instance_reason: string; unavailable_reason: string | null;
}
export interface CatalogSkill { id: number; name: string; hp_recovery: boolean; rarity: 'white' | 'gold' | 'unique'; icon_path: string | null }
export interface Catalog { courses: Course[]; skills: CatalogSkill[]; local_skill_data: boolean; local_skill_path?: string; local_skill_count?: number; local_icon_count?: number; engine_data_version?: string }
export interface StaminaBuild {
  running_style: number;
  stats: { speed: number; stamina: number; pow: number; guts: number; wiz: number };
  motivation: number;
  distance: [number, number, number, number];
  style: [number, number, number, number];
  ground: [number, number];
  skills: { id: number; level: number }[];
}
export interface RaceSelection { map_id: string; ground_condition: number; weather: number; season: number }
export type StaminaField = 'pacemaker' | 'average_lobby' | 'mirror';
export interface StaminaInput {
  request_id: string; target: 90 | 95 | 99; build: StaminaBuild; race: RaceSelection; field: StaminaField; seeds: number | null; assume_skills_activate: boolean; rushed: boolean; spot_struggle: boolean; dueling: boolean; lane_movement: boolean;
}
export interface StaminaRacesInput {
  request_id: string; target: 90 | 95 | 99; build: StaminaBuild; races: RaceSelection[]; field: StaminaField; seeds: number | null; assume_skills_activate: boolean; rushed: boolean; spot_struggle: boolean; dueling: boolean; lane_movement: boolean;
}
export interface StaminaRates {
  joint_percent: number;
  survival_percent: number; full_spurt_percent: number; full_spurt_at_entry_percent: number; avg_min_hp: number;
}
export interface StaminaPoint extends StaminaRates {
  stamina: number; seeds: number;
}
export interface Thresholds { joint: number | null; full_spurt: number | null; survival: number | null }
export interface StaminaResult {
  input: StaminaInput; request_id: string; curve: StaminaPoint[]; current: StaminaPoint;
  thresholds: Thresholds; threshold_samples: { joint: { seeds: number } | null; full_spurt: { seeds: number } | null; survival: { seeds: number } | null }; needed_effective_stamina: Thresholds; effective_stamina: number;
  heal_equivalents: { skill_id: number; fraction: number; stamina: number; variable: boolean }[];
  seeds: number; races: number; elapsed_ms: number; ms_per_race: number; course: Course;
}
export interface StaminaProgress { request_id: string; map_id: string; completed: number; total: number; stage: 'mapping' | 'refining' | 'done'; percent: number; race_index?: number; race_total?: number }
export interface StaminaRaceResult { request_id: string; index: number; total: number; result: StaminaResult }
export const groundNames = ['Firm', 'Good', 'Soft', 'Heavy'];
export const weatherNames = ['Sunny', 'Cloudy', 'Rainy', 'Snowy'];
export const seasonNames = ['Spring', 'Summer', 'Fall', 'Winter'];
export const defaultStaminaInput: StaminaInput = {
  request_id: '', target: 90, race: { map_id: 'nakayama-2500-turf-inner', ground_condition: 1, weather: 1, season: 4 },
  build: { running_style: 2, stats: { speed: 1200, stamina: 800, pow: 1000, guts: 600, wiz: 1000 },
    motivation: 5, distance: [7, 7, 7, 7], style: [7, 7, 7, 7], ground: [7, 7], skills: [] },
  field: 'average_lobby', seeds: null, assume_skills_activate: true, rushed: true, spot_struggle: false, dueling: false, lane_movement: true,
};
export function courseLabel(course: Course): string {
  return `${course.track_name} · ${course.distance} m · ${course.surface === 1 ? 'Turf' : 'Dirt'}${course.variant ? ` · ${course.variant}` : ''} · ${['Unknown', 'Right', 'Left', 'Straight (right)', 'Straight (left)'][course.direction] ?? 'Unknown'}`;
}

export const roleNames = ['Front', 'Pace', 'Late', 'End', 'Runaway'];
export function strategy(build: StaminaBuild): number { return build.running_style === 1 && build.skills.some(s => s.id === 202051) ? 5 : build.running_style; }
export function withStrategy(build: StaminaBuild, value: number): StaminaBuild {
  return { ...build, running_style: value === 5 ? 1 : value, skills: [...build.skills.filter(s => s.id !== 202051), ...(value === 5 ? [{ id: 202051, level: 1 }] : [])] };
}
