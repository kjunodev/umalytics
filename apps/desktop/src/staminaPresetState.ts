import bundled from '../src-tauri/data/role-kits.json';
import { getStaminaStore, restoreStaminaMemory } from './staminaState';
import { defaultStaminaInput, withStrategy, type Catalog, type StaminaBuild } from './staminaTypes';

export const roles = ['front', 'pace', 'late', 'end', 'runaway'] as const;
export type Role = typeof roles[number];
export const defaultKits = bundled;
export interface BuildPreset { id: string; name: string; build: StaminaBuild }
export interface PresetMemory { builds: BuildPreset[]; kits: Partial<Record<Role, number[]>>; defaults: StaminaBuild }
export const ballparkDefaults: StaminaBuild = { ...structuredClone(defaultStaminaInput.build),
  stats: { speed: 1600, stamina: 800, pow: 1200, guts: 600, wiz: 1200 } };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function restorePresets(value: unknown, catalog: Catalog): PresetMemory {
  const raw = object(value), kits = object(raw.kits);
  const memory: PresetMemory = { builds: [], kits: {}, defaults: structuredClone(ballparkDefaults) };
  if (raw.defaults && typeof raw.defaults === 'object') {
    memory.defaults = restoreStaminaMemory({ input: { build: { ...ballparkDefaults, ...object(raw.defaults), stats: { ...ballparkDefaults.stats, ...object(object(raw.defaults).stats) } } } }, catalog).input.build;
  }
  const rawStats = object(object(raw.defaults).stats);
  for (const key of ['speed', 'pow', 'guts', 'wiz'] as const) if (!(typeof rawStats[key] === 'number' && Number.isInteger(rawStats[key]) && rawStats[key] >= 1 && rawStats[key] <= 2000)) memory.defaults.stats[key] = ballparkDefaults.stats[key];
  const ids = new Set<string>();
  if (Array.isArray(raw.builds)) for (const item of raw.builds.slice(0, 100)) {
    const preset = object(item);
    if (typeof preset.id !== 'string' || !preset.id || preset.id.length > 128 || ids.has(preset.id) || typeof preset.name !== 'string' || !preset.name.trim()) continue;
    ids.add(preset.id);
    memory.builds.push({ id: preset.id, name: preset.name.trim().slice(0, 80), build: restoreStaminaMemory({ input: { build: preset.build } }, catalog).input.build });
  }
  for (const role of roles) if (Array.isArray(kits[role])) memory.kits[role] = [...new Set((kits[role] as unknown[]).filter((id): id is number => typeof id === 'number' && catalog.skills.some(s => s.id === id && s.rarity !== 'unique')))].slice(0, role === 'runaway' ? 99 : 100);
  return memory;
}
export function ballparkBuild(role: Role, memory: PresetMemory, current: StaminaBuild): StaminaBuild {
  const skills = (memory.kits[role] ?? bundled[role]).map(id => ({ id, level: 1 }));
  return withStrategy({ ...structuredClone(memory.defaults), stats: { ...memory.defaults.stats, stamina: current.stats.stamina }, skills }, roles.indexOf(role) + 1);
}
export async function loadPresets(catalog: Catalog): Promise<PresetMemory> { return restorePresets(await (await getStaminaStore()).get('presets-v1'), catalog); }
let saving = Promise.resolve();
export function savePresets(memory: PresetMemory) {
  const snapshot = structuredClone(memory);
  saving = saving.catch(() => {}).then(async () => { const store = await getStaminaStore(); await store.set('presets-v1', snapshot); await store.save(); });
  return saving;
}
