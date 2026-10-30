import { load } from '@tauri-apps/plugin-store';
import { defaultStaminaInput, type Catalog, type StaminaInput } from './staminaTypes';

export interface StaminaMemory { input: StaminaInput; recent: number[]; showAll: boolean }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const integer = (value: unknown, low: number, high: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;

export function restoreStaminaMemory(value: unknown, catalog: Catalog): StaminaMemory {
  const saved = object(value), raw = object(saved.input), race = object(raw.race), build = object(raw.build);
  const input = structuredClone(defaultStaminaInput);
  if (catalog.courses.some(c => c.id === race.map_id)) input.race.map_id = race.map_id as string;
  for (const key of ['ground_condition', 'weather', 'season'] as const) if (integer(race[key], 1, 4)) input.race[key] = race[key];
  if (integer(build.running_style, 1, 4)) input.build.running_style = build.running_style;
  if (integer(build.motivation, 1, 5)) input.build.motivation = build.motivation;
  const stats = object(build.stats);
  for (const key of ['speed', 'stamina', 'pow', 'guts', 'wiz'] as const) if (integer(stats[key], 1, 2000)) input.build.stats[key] = stats[key];
  for (const key of ['distance', 'style', 'ground'] as const) {
    const values = build[key];
    if (Array.isArray(values) && values.length === input.build[key].length && values.every(v => integer(v, 1, 8))) values.forEach((grade: number, i: number) => { input.build[key][i] = grade; });
  }
  const ids = new Set<number>();
  if (Array.isArray(build.skills)) for (const entry of build.skills.slice(0, 100)) {
    const skill = object(entry), known = catalog.skills.find(s => s.id === skill.id);
    if (known && !ids.has(known.id)) {
      ids.add(known.id);
      input.build.skills.push({ id: known.id, level: known.rarity === 'unique' && integer(skill.level, 1, 6) ? skill.level : 1 });
    }
  }
  if (['average_lobby', 'mirror', 'pacemaker'].includes(String(raw.field))) input.field = raw.field as StaminaInput['field'];
  if (integer(raw.seeds, 1, 1000)) input.seeds = raw.seeds;
  for (const key of ['assume_skills_activate', 'rushed', 'spot_struggle', 'dueling', 'lane_movement'] as const) if (typeof raw[key] === 'boolean') input[key] = raw[key];
  return { input, recent: Array.isArray(saved.recent) ? [...new Set(saved.recent.filter((id): id is number => typeof id === 'number' && catalog.skills.some(s => s.id === id)))].slice(0, 30) : [], showAll: saved.showAll === true };
}

let store: ReturnType<typeof load> | undefined;
const getStore = () => store ??= load('stamina.json', { autoSave: false, defaults: {} });
let saving = Promise.resolve();
export async function loadStaminaMemory(catalog: Catalog) { return restoreStaminaMemory(await (await getStore()).get('last-inputs-v1'), catalog); }
export function saveStaminaMemory(memory: StaminaMemory) {
  const snapshot = structuredClone(memory);
  snapshot.input.request_id = '';
  saving = saving.catch(() => {}).then(async () => { const target = await getStore(); await target.set('last-inputs-v1', snapshot); await target.save(); });
  return saving;
}

export function fuzzyScore(name: string, query: string): number {
  const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const haystack = normalize(name), needle = normalize(query).trim();
  if (!needle) return 0;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return exact;
  let position = 0, score = 100;
  for (const char of needle) { const found = haystack.indexOf(char, position); if (found < 0) return Infinity; score += found - position; position = found + 1; }
  return score;
}
