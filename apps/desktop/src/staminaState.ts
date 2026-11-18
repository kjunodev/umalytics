import { load } from '@tauri-apps/plugin-store';
import { defaultStaminaInput, type Catalog, type CatalogUma, type StaminaEditorBuild, type StaminaEditorInput, type StaminaInput } from './staminaTypes';
import type { CourseChoices } from './staminaDraft';
import { importedBuildSkills, restoreScreenshotImport, tierChains, type ScreenshotImport } from './staminaScreenshot';

export const buildTabLabels = { build: 'Build', race: 'Race', presets: 'Presets' } as const;
export type BuildTab = keyof typeof buildTabLabels;
export type StaminaView = 'requirement' | 'assessment';
export const staminaStatLabels = { speed: 'Speed', stamina: 'Stamina', pow: 'Power', guts: 'Guts', wiz: 'Wit' } as const;
export function editorStats(view: StaminaView) {
  return (Object.keys(staminaStatLabels) as (keyof typeof staminaStatLabels)[]).filter(stat => view === 'assessment' || stat !== 'stamina');
}
export const recentUmaLimit = 5;
export interface StaminaMemory { mechanicsDefaults?: number; input: StaminaEditorInput; draftInput?: StaminaEditorInput; recent: number[]; recentUmas: number[]; view: StaminaView; buildTab: BuildTab; buildCustomized?: boolean; courseChoices?: CourseChoices }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const integer = (value: unknown, low: number, high: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;

export function selectUma(build: StaminaEditorBuild, uma: CatalogUma | undefined, catalog: Catalog): StaminaEditorBuild {
  const uniqueIds = new Set(catalog.skills.filter(skill => skill.rarity === 'unique').map(skill => skill.id));
  for (const card of catalog.umas) uniqueIds.add(card.unique_skill_id);
  const previous = build.skills.find(skill => skill.id === uma?.unique_skill_id) ?? build.skills.find(skill => uniqueIds.has(skill.id));
  const ordinary = build.skills.filter(skill => !uniqueIds.has(skill.id) && skill.id !== uma?.unique_skill_id);
  const skills = uma ? [...ordinary.slice(0, 99), { id: uma.unique_skill_id, level: previous?.level ?? 4 }] : ordinary;
  return { ...build, umaCardId: uma?.card_id, skills };
}

export function restoreStaminaMemory(value: unknown, catalog: Catalog, defaultTarget: StaminaInput['target'] = 90): StaminaMemory {
  const saved = object(value), raw = object(saved.input), race = object(raw.race), build = object(raw.build);
  const input: StaminaEditorInput = structuredClone(defaultStaminaInput);
  input.target = defaultTarget;
  if (catalog.courses.some(c => c.id === race.map_id)) input.race.map_id = race.map_id as string;
  for (const key of ['ground_condition', 'weather', 'season'] as const) if (integer(race[key], 1, 4)) input.race[key] = race[key];
  if (integer(build.running_style, 1, 4)) input.build.running_style = build.running_style;
  if (integer(build.motivation, 1, 5)) input.build.motivation = build.motivation;
  const stats = object(build.stats);
  for (const key of ['speed', 'stamina', 'pow', 'guts', 'wiz'] as const) if (integer(stats[key], 1, 2000)) input.build.stats[key] = stats[key];
  if (build.usesDefaultStamina === true || !integer(stats.stamina, 1, 2000)) input.build.usesDefaultStamina = true;
  for (const key of ['distance', 'style', 'ground'] as const) {
    const values = build[key];
    if (Array.isArray(values) && values.length === input.build[key].length && values.every(v => integer(v, 1, 8))) values.forEach((grade: number, i: number) => { input.build[key][i] = grade; });
  }
  const selectedUma = catalog.umas?.find(uma => uma.card_id === build.umaCardId);
  const ids = new Set<number>();
  if (Array.isArray(build.skills)) for (const entry of build.skills.slice(0, 100)) {
    const skill = object(entry), known = catalog.skills.find(s => s.id === skill.id);
    if (known && !ids.has(known.id)) {
      ids.add(known.id);
      const isSelectedUnique = known.id === selectedUma?.unique_skill_id;
      const level = (isSelectedUnique || known.rarity === 'unique') && integer(skill.level, 1, 6) ? skill.level : isSelectedUnique ? 4 : 1;
      input.build.skills.push({ id: known.id, level });
    }
  }
  if (build.umaCardId !== undefined) {
    input.build = selectUma(input.build, selectedUma, catalog);
  } else {
    const uniques = input.build.skills.filter(skill => catalog.skills.find(meta => meta.id === skill.id)?.rarity === 'unique');
    const candidates = uniques.length === 1 ? catalog.umas?.filter(uma => uma.unique_skill_id === uniques[0]!.id) : undefined;
    if (candidates?.length === 1) input.build.umaCardId = candidates[0]!.card_id;
  }
  if (['average_lobby', 'mirror', 'pacemaker'].includes(String(raw.field))) input.field = raw.field as StaminaInput['field'];
  if (raw.target === 90 || raw.target === 95 || raw.target === 99) input.target = raw.target;
  if (integer(raw.seeds, 1, 1000)) input.seeds = raw.seeds;
  for (const key of ['assume_skills_activate', 'rushed', 'lane_movement'] as const) if (typeof raw[key] === 'boolean') input[key] = raw[key];
  if (saved.mechanicsDefaults === 2) for (const key of ['spot_struggle', 'dueling'] as const) if (typeof raw[key] === 'boolean') input[key] = raw[key];
  const screenshotImport = catalog.screenshot_import_enabled
    ? restoreScreenshotImport(raw.screenshotImport, catalog.screenshot_skills) : undefined;
  if (screenshotImport && catalog.screenshot_skills) {
    if (screenshotImport.manualSkills) screenshotImport.manualSkills = screenshotImport.manualSkills.filter(id => catalog.skills.some(skill => skill.id === id && skill.rarity !== 'unique'));
    const skills = importedBuildSkills(screenshotImport, tierChains(screenshotImport.observations, catalog.screenshot_skills), catalog.screenshot_skills);
    if (skills.length <= 100) {
      input.screenshotImport = screenshotImport;
      input.build.skills = skills;
    }
  }
  const undo = object(raw.importUndo);
  if (catalog.screenshot_import_enabled && undo.build) {
    const previous = restoreStaminaMemory({ input: { build: undo.build, screenshotImport: undo.screenshotImport } }, catalog).input;
    input.importUndo = { build: previous.build, screenshotImport: previous.screenshotImport };
  }
  const courseChoices: CourseChoices = Object.fromEntries(Object.entries(object(saved.courseChoices)).slice(-100).flatMap(([code, entries]) => {
    if (!code.trim() || code.length > 80) return [];
    const valid = Object.entries(object(entries)).filter((entry): entry is [string, string] => entry[0].length <= 2048 && typeof entry[1] === 'string' && catalog.courses.some(c => c.id === entry[1])).slice(-7);
    return valid.length ? [[code, Object.fromEntries(valid)]] : [];
  }));
  const buildTab = saved.buildTab === 'race' || saved.buildTab === 'race-settings' ? 'race'
    : saved.buildTab === 'presets' ? 'presets' : 'build';
  const recentUmas = Array.isArray(saved.recentUmas) ? [...new Set(saved.recentUmas.filter((id): id is number =>
    typeof id === 'number' && !!catalog.umas?.some(uma => uma.card_id === id)))].slice(0, recentUmaLimit) : [];
  const view = saved.view === 'assessment' ? 'assessment' : 'requirement';
  const { usesDefaultStamina: _usesDefaultStamina, ...buildValues } = input.build;
  return { input, view, buildTab, recentUmas, buildCustomized: typeof saved.buildCustomized === 'boolean' ? saved.buildCustomized : JSON.stringify(buildValues) !== JSON.stringify(defaultStaminaInput.build), ...(Object.keys(courseChoices).length ? { courseChoices } : {}), ...(saved.draftInput ? { draftInput: restoreStaminaMemory({ input: saved.draftInput, mechanicsDefaults: saved.mechanicsDefaults }, catalog, defaultTarget).input } : {}), recent: Array.isArray(saved.recent) ? [...new Set(saved.recent.filter((id): id is number => typeof id === 'number' && catalog.skills.some(s => s.id === id)))].slice(0, 30) : [] };
}

export function applyScreenshotBuild(input: StaminaEditorInput, build: Partial<StaminaEditorBuild>, scan: ScreenshotImport): StaminaEditorInput {
  return { ...input, build: { ...input.build, ...build, usesDefaultStamina: undefined }, screenshotImport: scan,
    importUndo: { build: input.build, screenshotImport: input.screenshotImport } };
}

export function undoScreenshotBuild(input: StaminaEditorInput): StaminaEditorInput {
  return input.importUndo ? { ...input, ...input.importUndo, importUndo: undefined } : input;
}

let store: ReturnType<typeof load> | undefined;
export const getStaminaStore = () => store ??= load('stamina.json', { autoSave: false, defaults: {} });
let saving = Promise.resolve();
export async function loadStaminaMemory(catalog: Catalog, defaultTarget: StaminaInput['target'] = 90) { return restoreStaminaMemory(await (await getStaminaStore()).get('last-inputs-v1'), catalog, defaultTarget); }
export function saveStaminaMemory(memory: StaminaMemory, screenshotImportEnabled = false) {
  const snapshot = structuredClone(memory);
  snapshot.mechanicsDefaults = 2;
  snapshot.input.request_id = '';
  if (snapshot.draftInput) snapshot.draftInput.request_id = '';
  saving = saving.catch(() => {}).then(async () => {
    const target = await getStaminaStore();
    if (!screenshotImportEnabled) {
      const previous = object(await target.get('last-inputs-v1'));
      for (const key of ['input', 'draftInput'] as const) {
        const current = snapshot[key];
        if (!current) continue;
        for (const field of ['screenshotImport', 'importUndo'] as const) {
          const hidden = object(previous[key])[field];
          if (current[field] === undefined && hidden !== undefined) Object.assign(current, { [field]: hidden });
        }
      }
    }
    await target.set('last-inputs-v1', snapshot);
    await target.save();
  });
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
