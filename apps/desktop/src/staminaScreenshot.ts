import type { StaminaBuild } from './staminaTypes';

export type Screen = 'attributes-numbers' | 'attributes-chart' | 'career-skills' | 'details-skills' | 'finished-details' | 'learn' | 'unsupported';
export interface ScreenshotRow {
  raw_name: string;
  resolution: { matched: { id: number; confidence: number } } | 'ignored_no_race_effect' | null;
  variant_choice?: { name: string; circle: number; double_circle: number; suggested?: number };
  fields: { cost: number | null; hint: number | null; level: number | null; obtained: boolean | null; hint_unreadable?: boolean; hint_conflict?: boolean };
}
export interface Screenshot {
  screen: Screen;
  instruction: string | null;
  attributes: { stats: (number | null)[]; track: string; distance: string; style: string } | null;
  card: { id: number; name: string; title: string } | null;
  skill_points: number | null;
  skills: ScreenshotRow[];
}
export interface ImportSkill { cost: number | null; tier: { group: number; rank: number } | null; hint_from?: number }
export type ImportCatalog = Record<number, ImportSkill>;
export interface Observation {
  id: number; owned: boolean; level: number | null; price: number | null; hint: number | null;
  learn?: boolean; hintUnreadable?: boolean; hintConflict?: boolean;
}
export interface ScreenshotImport {
  points: number | null;
  observations: Observation[];
  ignored: string[];
  selected: number[];
}

export const hintDiscount = (hint: number | null) => [0, 10, 20, 30, 35, 40][hint ?? 0] ?? 0;

export function discountedPrice(base: number, hint: number | null): number {
  return Math.floor(base * (100 - hintDiscount(hint)) / 100);
}

export function dedupeRows(rows: Observation[]) {
  const skills = new Map<number, { owned: boolean; level: number; learn: Observation[] }>();
  for (const row of rows) {
    const skill = skills.get(row.id) ?? { owned: false, level: 1, learn: [] };
    skill.owned ||= row.owned;
    skill.level = Math.max(skill.level, row.level ?? 1);
    if ((row.learn || !row.owned || row.hint !== null) && !skill.learn.some(entry =>
      entry.owned === row.owned && entry.price === row.price && entry.hint === row.hint &&
      !!entry.hintUnreadable === !!row.hintUnreadable && !!entry.hintConflict === !!row.hintConflict)) {
      skill.learn.push(row);
    }
    skills.set(row.id, skill);
  }
  return skills;
}

export interface TierStep {
  id: number;
  rank: number;
  owned: boolean;
  selectable: boolean;
  hint: number | null;
  tierPrice: number | null;
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
  const catalogGroups = new Map<number, number[]>();
  const rank = (id: number) => catalog[id]?.tier?.rank ?? 0;
  for (const [id, meta] of Object.entries(catalog)) {
    if (!meta.tier) continue;
    const family = catalogGroups.get(meta.tier.group) ?? [];
    family.push(Number(id));
    catalogGroups.set(meta.tier.group, family);
  }
  for (const id of seen.keys()) {
    const tier = catalog[id]?.tier;
    const key = tier ? `group-${tier.group}` : `skill-${id}`;
    const group = groups.get(key) ?? [];
    group.push(id);
    groups.set(key, group);
  }
  const scannedHint = (id: number): number | null | undefined => {
    const reads = seen.get(id)?.learn ?? [];
    const hints = new Set(reads.filter(row => !row.hintUnreadable).map(row => row.hint));
    return !reads.length ? null : hints.size === 1 ? [...hints][0] : undefined;
  };
  const hintFor = (id: number): number | null | undefined => {
    const from = catalog[id]?.hint_from;
    const direct = scannedHint(id);
    return from !== undefined && (direct === undefined || !seen.get(id)?.learn.length) ? scannedHint(from) : direct;
  };
  const price = (id: number, hint: number | null | undefined) => {
    const base = catalog[id]?.cost;
    return base == null || hint === undefined ? null : discountedPrice(base, hint);
  };
  return [...groups].map(([key, ids]) => {
    ids.sort((a, b) => rank(a) - rank(b) || a - b);
    const ownedId = [...ids].reverse().find(id => seen.get(id)?.owned);
    const group = catalog[ids[0]!]?.tier?.group;
    const ownedRank = ownedId === undefined ? -1 : rank(ownedId);
    const owned = ownedId === undefined ? undefined : { id: ownedId, level: seen.get(ownedId)!.level };
    const lastOfferedRank = Math.max(ownedRank, ...ids.filter(id => seen.get(id)!.learn.length).map(rank));
    for (const id of (group === undefined ? [] : catalogGroups.get(group) ?? [])) {
      const hintFrom = catalog[id]?.hint_from;
      const unlockedCircle = hintFrom !== undefined && !!seen.get(hintFrom)?.learn.length;
      if (rank(id) > ownedRank && (rank(id) < lastOfferedRank || unlockedCircle) && !ids.some(existing => rank(existing) === rank(id))) ids.push(id);
    }
    ids.sort((a, b) => rank(a) - rank(b) || a - b);
    const needsHint = (id: number) => {
      const from = catalog[id]?.hint_from;
      return !seen.get(id)?.learn.length && (from === undefined || !seen.get(from)?.learn.length);
    };
    const steps = ids.flatMap<TierStep>(id => {
      const reads = seen.get(id)?.learn ?? [];
      const offers = reads.filter(row => !row.owned);
      const scanned = [...new Set(offers.flatMap(offer => offer.price === null ? [] : [offer.price]))].sort((a, b) => a - b);
      const prerequisites = ids.filter(lower => rank(lower) > ownedRank && rank(lower) < rank(id));
      const prices = prerequisites.map(lower => price(lower, hintFor(lower)));
      const prefix = prices.some(value => value === null) ? null : prices.reduce<number>((sum, value) => sum + (value ?? 0), 0);
      const withPrerequisite = (own: number | null) => own === null || prefix === null ? null : own + prefix;
      const hint = hintFor(id);
      const tierPrice = price(id, hint);
      const total = withPrerequisite(tierPrice);
      const mismatch = offers.some(offer => {
        const calculated = withPrerequisite(price(id, offer.hintUnreadable ? hint : offer.hint));
        return offer.price !== null && calculated !== null && offer.price !== calculated;
      });
      const isOwned = rank(id) <= ownedRank;
      const unverified = (!isOwned && (total === null || needsHint(id) || prerequisites.some(needsHint)))
        || reads.some(row => row.hintUnreadable || row.hintConflict || (!row.owned && row.price === null));
      if (isOwned && !seen.get(id)?.owned && !offers.length) return [];
      return [{ id, rank: rank(id), owned: isOwned, selectable: !isOwned, hint: hint ?? null, tierPrice, total, scanned,
        priceIssue: mismatch ? 'Price mismatch' : unverified ? 'Price unverified' : null }];
    });
    return { key, owned, steps };
  });
}

export function priceAfterTier(chain: SkillChain, step: TierStep, selectedId: number | undefined) {
  const paid = chain.steps.find(tier => tier.id === selectedId);
  if (!paid) return step.total;
  if (paid.rank >= step.rank) return step.tierPrice;
  const tiers = chain.steps.filter(tier => tier.rank > paid.rank && tier.rank <= step.rank && tier.selectable);
  return tiers.some(tier => tier.tierPrice === null) ? null : tiers.reduce((sum, tier) => sum + tier.tierPrice!, 0);
}

export function purchasePlan(chains: SkillChain[], selected: number[], points: number | null) {
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
  return { skills, left: hasUnknownPrice || points === null ? null : points - spent, overBy: points === null ? 0 : Math.max(0, spent - points) };
}

export function selectTier(selected: number[], chain: SkillChain, id: number | undefined) {
  return [...selected.filter(choice => !chain.steps.some(step => step.id === choice)), ...(id === undefined ? [] : [id])];
}

export function restoreScreenshotImport(value: unknown, catalog: ImportCatalog | undefined): ScreenshotImport | undefined {
  if (!catalog || !value || typeof value !== 'object') return undefined;
  const { points, observations, selected, ignored } = value as Partial<ScreenshotImport>;
  if (points === undefined || (points !== null && (!Number.isInteger(points) || points < 0 || points > 65535)) || !Array.isArray(observations)) return undefined;
  const validNumber = (n: number | null, low: number, high: number) =>
    n === null || (Number.isInteger(n) && n >= low && n <= high);
  const rows = observations.filter(row => row && Number.isInteger(row.id) && Object.hasOwn(catalog, row.id) && typeof row.owned === 'boolean'
    && (points !== null || row.owned)
    && validNumber(row.level, 1, 6) && validNumber(row.price, 0, 65535) && validNumber(row.hint, 1, 5));
  return {
    points,
    observations: rows,
    selected: points !== null && Array.isArray(selected) ? [...new Set(selected.filter(id => Number.isInteger(id) && Object.hasOwn(catalog, id)))] : [],
    ignored: Array.isArray(ignored) ? ignored.filter(text => typeof text === 'string') : [],
  };
}
