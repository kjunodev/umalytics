import type { StaminaBuild } from './staminaTypes';

export type Screen = 'attributes-numbers' | 'attributes-chart' | 'career-skills' | 'details-skills' | 'learn' | 'unsupported';
export interface ScreenshotRow {
  raw_name: string;
  resolution: { matched: { id: number; confidence: number } } | 'ignored_no_race_effect' | null;
  fields: { cost: number | null; hint: number | null; level: number | null; obtained: boolean | null; hint_unreadable?: boolean };
}
export interface Screenshot {
  screen: Screen;
  instruction: string | null;
  attributes: { stats: (number | null)[]; track: string; distance: string; style: string } | null;
  card: { id: number; name: string; title: string } | null;
  skill_points: number | null;
  skills: ScreenshotRow[];
}
export interface ImportSkill { cost: number | null; tier: { group: number; rank: number } | null }
export type ImportCatalog = Record<number, ImportSkill>;
export interface Observation { id: number; owned: boolean; level: number | null; price: number | null; hint: number | null; hintUnreadable?: boolean }
export interface ScreenshotImport {
  points: number;
  observations: Observation[];
  ignored: string[];
  selected: number[];
}

export function discountedPrice(base: number, hint: number | null): number {
  const discounts = [0, 10, 20, 30, 35, 40];
  return Math.floor(base * (100 - (discounts[hint ?? 0] ?? 0)) / 100);
}

export function dedupeRows(rows: Observation[]) {
  const skills = new Map<number, { owned: boolean; level: number; offers: Observation[] }>();
  for (const row of rows) {
    const skill = skills.get(row.id) ?? { owned: false, level: 1, offers: [] };
    skill.owned ||= row.owned;
    skill.level = Math.max(skill.level, row.level ?? 1);
    if (!row.owned && !skill.offers.some(offer => offer.price === row.price && offer.hint === row.hint && !!offer.hintUnreadable === !!row.hintUnreadable)) {
      skill.offers.push(row);
    }
    skills.set(row.id, skill);
  }
  return skills;
}

export interface TierStep {
  id: number;
  selectable: boolean;
  total: number | null;
  scanned: number[];
  priceIssue: 'Price mismatch' | 'Price unverified' | null;
}
export interface SkillChain {
  key: string;
  owned?: { id: number; level: number };
  steps: TierStep[];
}

export function tierChains(rows: Observation[], catalog: ImportCatalog): SkillChain[] {
  const seen = dedupeRows(rows);
  const groups = new Map<string, number[]>();
  const bases = new Map<number, number[]>();
  const rank = (id: number) => catalog[id]?.tier?.rank ?? 0;
  for (const [id, meta] of Object.entries(catalog)) {
    if (meta.cost === null || meta.tier?.rank !== 1) continue;
    const base = bases.get(meta.tier.group) ?? [];
    base.push(Number(id));
    bases.set(meta.tier.group, base);
  }
  for (const id of seen.keys()) {
    const tier = catalog[id]?.tier;
    const key = tier ? `group-${tier.group}` : `skill-${id}`;
    const group = groups.get(key) ?? [];
    group.push(id);
    groups.set(key, group);
  }
  const price = (id: number, offer?: Observation) => {
    const base = catalog[id]?.cost;
    return base == null || offer?.hintUnreadable ? null : discountedPrice(base, offer?.hint ?? null);
  };
  const commonPrice = (id: number) => {
    const offers = seen.get(id)?.offers ?? [];
    const prices = new Set(offers.length ? offers.filter(offer => !offer.hintUnreadable).map(offer => price(id, offer)) : [price(id)]);
    return prices.size === 1 ? [...prices][0]! : null;
  };
  return [...groups].map(([key, ids]) => {
    ids.sort((a, b) => rank(a) - rank(b) || a - b);
    const ownedId = [...ids].reverse().find(id => seen.get(id)?.owned);
    const group = catalog[ids[0]!]?.tier?.group;
    const base = group === undefined ? undefined : bases.get(group);
    // A combined offer can be visible before its prerequisite is captured.
    if (ownedId === undefined && rank(ids[0]!) > 1 && base?.length === 1) ids.unshift(base[0]!);
    const ownedRank = ownedId === undefined ? -1 : rank(ownedId);
    const owned = ownedId === undefined ? undefined : { id: ownedId, level: seen.get(ownedId)!.level };
    const steps = ids.flatMap<TierStep>(id => {
      const offers = seen.get(id)?.offers ?? [];
      const scanned = [...new Set(offers.flatMap(offer => offer.price === null ? [] : [offer.price]))].sort((a, b) => a - b);
      // Both upgrades charge for the base skill if the group is unowned.
      const prerequisite = ownedId === undefined && rank(ids[0]!) < rank(id) ? ids[0] : undefined;
      const prefix = prerequisite === undefined ? 0 : commonPrice(prerequisite);
      const withPrerequisite = (own: number | null) => own === null || prefix === null ? null : own + prefix;
      const total = withPrerequisite(commonPrice(id));
      const mismatch = offers.some(offer => {
        const calculated = withPrerequisite(offer.hintUnreadable ? commonPrice(id) : price(id, offer));
        return offer.price !== null && calculated !== null && offer.price !== calculated;
      });
      const unverified = total === null || !offers.length || (prerequisite !== undefined && !seen.get(prerequisite)?.offers.length)
        || offers.some(offer => offer.price === null || offer.hintUnreadable);
      if (rank(id) <= ownedRank && (!offers.length || (!mismatch && !unverified))) return [];
      return [{ id, selectable: rank(id) > ownedRank, total, scanned, priceIssue: mismatch ? 'Price mismatch' : unverified ? 'Price unverified' : null }];
    });
    return { key, owned, steps };
  });
}

export function purchasePlan(chains: SkillChain[], selected: number[], points: number) {
  let spent = 0;
  let hasUnknownPrice = false;
  const skills: StaminaBuild['skills'] = [];
  for (const chain of chains) {
    const choice = [...chain.steps].reverse().find(step => step.selectable && selected.includes(step.id));
    if (choice) {
      if (choice.total === null) hasUnknownPrice = true;
      else spent += choice.total;
      skills.push({ id: choice.id, level: 1 });
    } else if (chain.owned) skills.push(chain.owned);
  }
  skills.sort((a, b) => a.id - b.id);
  return { skills, left: hasUnknownPrice ? null : points - spent, overBudget: spent > points };
}

export function selectTier(selected: number[], chain: SkillChain, id: number | undefined) {
  return [...selected.filter(choice => !chain.steps.some(step => step.id === choice)), ...(id === undefined ? [] : [id])];
}

export function restoreScreenshotImport(value: unknown, catalog: ImportCatalog | undefined): ScreenshotImport | undefined {
  if (!catalog || !value || typeof value !== 'object') return undefined;
  const { points, observations, selected, ignored } = value as Partial<ScreenshotImport>;
  if (points == null || !Number.isInteger(points) || points < 0 || points > 65535 || !Array.isArray(observations)) return undefined;
  const validNumber = (n: number | null, low: number, high: number) =>
    n === null || (Number.isInteger(n) && n >= low && n <= high);
  const rows = observations.filter(row => row && Number.isInteger(row.id) && Object.hasOwn(catalog, row.id) && typeof row.owned === 'boolean'
    && validNumber(row.level, 1, 6) && validNumber(row.price, 0, 65535) && validNumber(row.hint, 1, 5));
  return {
    points,
    observations: rows,
    selected: Array.isArray(selected) ? [...new Set(selected.filter(id => Number.isInteger(id) && Object.hasOwn(catalog, id)))] : [],
    ignored: Array.isArray(ignored) ? ignored.filter(text => typeof text === 'string') : [],
  };
}
