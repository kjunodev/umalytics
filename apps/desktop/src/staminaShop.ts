import { priceAfterTier, type SkillChain, type TierStep } from './staminaScreenshot';
import { displaySkillName, type Catalog, type CatalogSkill, type HpEffect } from './staminaTypes';

export type ShopFilter = 'All' | 'Recoveries' | 'Gold';
export type ShopSort = 'name' | 'price' | 'recovery';

export function hpPercent(value: number): string {
  return `${value < 0 ? '−' : ''}${Math.abs(value) / 100}% HP`;
}

export function hpEffectTitle(effect: HpEffect): string {
  return `${hpPercent(effect.value)}${effect.other_runner ? ' of the affected runner' : ''}${effect.conditional ? ' if it activates' : ''}`;
}

export function shopOffers(chains: SkillChain[], purchases: TierStep[], catalog: Catalog) {
  const skills = new Map(catalog.skills.map(skill => [skill.id, skill]));
  return chains.flatMap(chain => {
    const tiers = chain.steps.filter(step => step.selectable);
    const selected = tiers.findIndex(step => purchases.includes(step));
    const paid = tiers[selected];
    return tiers.map((step, index) => {
      const meta: CatalogSkill | undefined = skills.get(step.id);
      const hp = step.removal ? [] : catalog.hp_effects?.[step.id] ?? [];
      const positives = hp.filter(effect => effect.value > 0);
      const recovery = positives.length > 0 || (!step.removal && !!meta?.hp_recovery);
      const gold = !step.removal && meta?.rarity === 'gold';
      const skillName = displaySkillName(meta?.name ?? `Skill ${step.id}`);
      const name = step.removal ? `Remove ${skillName}` : skillName;
      const price = index === selected ? step.total : priceAfterTier(chain, step, paid?.id);
      const extraCost = index > selected ? price : null;
      const hpSort = positives.length ? Math.max(...positives.map(effect => effect.value))
        : hp.length ? Math.min(...hp.map(effect => effect.value)) : null;
      return { chain, tiers, selected, index, step, name, skillName, meta, hp, recovery, gold, price, extraCost, hpSort };
    });
  });
}

export function filterShopOffers(offers: ReturnType<typeof shopOffers>, filter: ShopFilter, query: string, sort: ShopSort, descending: boolean) {
  const match = query.trim().toLocaleLowerCase();
  const compareAmount = (left: number | null, right: number | null) => {
    if (left === null || right === null) return Number(left === null) - Number(right === null);
    return (left - right) * (descending ? -1 : 1);
  };
  return offers.filter(offer => offer.name.toLocaleLowerCase().includes(match) &&
    (filter === 'All' || filter === 'Recoveries' && offer.recovery || filter === 'Gold' && offer.gold))
    .sort((a, b) => {
      const name = a.name.localeCompare(b.name);
      if (sort === 'name') return name * (descending ? -1 : 1);
      return (sort === 'price' ? compareAmount(a.price, b.price) : compareAmount(a.hpSort, b.hpSort)) || name;
    });
}
