export interface Course {
  id: number;
  track_name: string;
  distance: number;
  surface: number;
  direction: number;
  race_instance_id: number | null;
}
export interface Preset {
  id: number;
  name: string;
  date: string | null;
  course_set_id: number;
  ground_condition: number;
  weather: number;
  season: number;
}
export interface Catalog {
  courses: Course[];
  presets: Preset[];
  skills: { id: number; name: string }[];
}
export interface StaminaInput {
  request_id: string;
  course_set_id: number;
  ground_condition: number;
  weather: number;
  season: number;
  running_style: number;
  stats: { speed: number; stamina: number; pow: number; guts: number; wiz: number };
  motivation: number;
  distance: [number, number, number, number];
  style: [number, number, number, number];
  ground: [number, number];
  skills: { id: number; level: number }[];
  seeds: number;
}
export interface StaminaPoint {
  stamina: number;
  no_hp_out_percent: number;
  avg_min_hp: number;
}
export interface StaminaResult {
  request_id: string;
  curve: StaminaPoint[];
  current: StaminaPoint;
  threshold: number | null;
  seeds: number;
  races: number;
  elapsed_ms: number;
  ms_per_race: number;
  race_instance_id: number;
}
export interface StaminaProgress { request_id: string; completed: number; total: number }

export const defaultStaminaInput: StaminaInput = {
  request_id: '', course_set_id: 10506, ground_condition: 2, weather: 2, season: 4,
  running_style: 2, stats: { speed: 1200, stamina: 800, pow: 1000, guts: 600, wiz: 1000 },
  motivation: 5, distance: [7, 7, 7, 7], style: [7, 7, 7, 7], ground: [7, 7],
  skills: [], seeds: 200,
};

export function courseLabel(course: Course): string {
  return `${course.track_name} · ${course.distance} m · ${course.surface === 1 ? 'Turf' : 'Dirt'} · ${
    ['Unknown', 'Right', 'Left', 'Straight (right)', 'Straight (left)'][course.direction] ?? 'Unknown'
  } (${course.id})`;
}
