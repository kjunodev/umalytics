import { useMemo, useState, type ReactNode, type Ref } from 'react';
import { HpAmounts, SkillIcon } from './SkillPicker';
import { filterShopOffers, shopOffers, type ShopFilter, type ShopSort } from './staminaShop';
import { hintDiscount, purchaseList, purchasePlan, selectTier, type ScreenshotImport, type SkillChain } from './staminaScreenshot';
import type { Catalog } from './staminaTypes';

const filters: ShopFilter[] = ['All', 'Recoveries', 'Gold', 'Affordable'];
const format = (amount: number) => amount.toLocaleString('en-US');
export const shopPrice = (amount: number | null) => amount === null ? 'Price unknown' : `${format(amount)} SP`;

export function StaminaSkillShop({ catalog, scan, chains, plan, skillCount, running, runLabel, runDisabled, onRun, onChange, onRemove, manualPicker, shopRef }: {
  catalog: Catalog;
  scan: ScreenshotImport;
  chains: SkillChain[];
  plan: ReturnType<typeof purchasePlan>;
  skillCount: number;
  running: boolean;
  runLabel: string;
  runDisabled: boolean;
  onRun: () => void;
  onChange: (ids: number[]) => void;
  onRemove: () => void;
  manualPicker: ReactNode;
  shopRef: Ref<HTMLElement>;
}) {
  const [filter, setFilter] = useState<ShopFilter>('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: ShopSort; descending: boolean }>({ key: 'name', descending: false });
  const [copyStatus, setCopyStatus] = useState('');
  const offers = useMemo(() => shopOffers(chains, plan.purchases, catalog), [chains, plan.purchases, catalog]);
  const rows = useMemo(() => filterShopOffers(offers, filter, query, plan.left, sort.key, sort.descending), [offers, filter, query, plan.left, sort]);
  const name = (id: number) => catalog.skills.find(skill => skill.id === id)?.name ?? `Skill ${id}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(purchaseList(plan.purchases, name));
      setCopyStatus('List copied');
    } catch { setCopyStatus('Unable to copy list'); }
  };
  const column = (key: ShopSort, label: string) =>
    <th scope="col" aria-sort={sort.key === key ? sort.descending ? 'descending' : 'ascending' : undefined}>
      <button type="button" onClick={() => setSort(current => ({ key, descending: current.key === key ? !current.descending : key === 'recovery' }))}>
        {label}{sort.key === key && <span aria-hidden="true">{sort.descending ? ' ↓' : ' ↑'}</span>}
      </button>
    </th>;

  return <section className="panel skill-shop" ref={shopRef} tabIndex={-1} aria-label="Skill shop">
    <header className="shop-header">
      <div className="shop-title"><h2>Skill shop</h2><button type="button" disabled={runDisabled} onClick={onRun}>{runLabel}</button></div>
      <div className="shop-budget" role="status">
        <strong className={plan.overBy ? 'import-warning' : undefined}>{plan.left === null ? 'Unknown' : format(plan.left)} / {format(scan.points!)} SP left</strong>
        {plan.overBy > 0 && <small className="import-warning">{format(plan.overBy)} SP over budget</small>}
        {plan.left === null && <small>A selected price could not be calculated.</small>}
      </div>
      <div className="shop-buying"><span>Buying <strong>{plan.purchases.length} · {shopPrice(plan.spent)}</strong></span>
        <button type="button" disabled={!plan.purchases.length} onClick={() => void copy()}>Copy list</button>
        {copyStatus && <small role="status">{copyStatus}</small>}
      </div>
      <div className="shop-filters">
        <div className="seg" role="group" aria-label="Filter skill offers">{filters.map(value =>
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div>
        <input type="search" aria-label="Search skill offers" placeholder="Search skills…" value={query} onChange={event => setQuery(event.target.value)}/>
      </div>
    </header>
    <div className="shop-scroll">
      <table aria-label="Skill offers">
        <colgroup>{['skill', 'hint', 'price', 'recovery', 'tier'].map(name => <col key={name} className={`shop-col-${name}`}/>)}</colgroup>
        <thead><tr>{column('name', 'Skill')}<th scope="col">Hint</th>{column('price', 'Price')}{column('recovery', 'Recovery')}<th scope="col">Tier</th></tr></thead>
        <tbody>{rows.map(({ chain, tiers, selected, index, step, name, meta, hp, recovery, gold, price }) => {
          const bought = index === selected;
          const skillName = meta?.name ?? `Skill ${step.id}`;
          const choose = (id?: number) => {
            setCopyStatus('');
            onChange(selectTier(scan.selected, chain, id));
          };
          return <tr key={`${chain.key}-${step.id}`} data-bought={bought}>
            <th scope="row"><span className="import-skill-name"><SkillIcon skill={meta}/><span>{name}</span></span>
              <span className="shop-tags">
                {recovery && <small>Recovery</small>}{gold && <small>Gold</small>}
                {step.removal && <small>Debuff / Remove</small>}
                {hp.some(effect => effect.value < 0) && <small>Drain</small>}
              </span>
              {step.inferredFrom !== undefined && <small className="muted">Price from {catalog.skills.find(skill => skill.id === step.inferredFrom)?.name ?? 'another tier'}</small>}
              {step.estimated && <small className="import-warning">Estimated upgrade price</small>}
              {step.priceIssue && <small className="import-warning">{step.priceIssue}{step.scanned.length ? ` · Scanned ${step.scanned.map(format).join(' / ')} SP` : ' · No scanned price'}</small>}
            </th>
            <td>{step.hint ? <span title={`${hintDiscount(step.hint)}% off`}>{step.hint === 5 ? 'Max' : `Lv ${step.hint}`}</span> : '—'}</td>
            <td className="shop-price" title={price === null ? 'Price unknown' : undefined}>{price === null ? '—' : shopPrice(price)}</td>
            <td>{hp.length ? <HpAmounts effects={hp}/> : '—'}</td>
            <td><div className="import-stepper" role="group" aria-label={`Purchase tier for ${name}`}>
              <button type="button" aria-label={step.removal ? `Undo removal for ${skillName}` : `Decrease tier for ${name}`} disabled={running || !bought} onClick={() => choose(tiers[index - 1]?.id)}>−</button>
              <button type="button" aria-label={step.removal ? `Buy removal for ${skillName}` : `Increase tier for ${name}`}
                disabled={running || index <= selected || (selected < 0 ? !chain.owned : tiers[selected]?.removal) && !step.removal && skillCount >= 100}
                onClick={() => choose(step.id)}>+</button>
            </div></td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length && <p className="shop-empty" role="status">No matching offers.</p>}
      <div className="shop-manual">{manualPicker}</div>
      {scan.ignored.length > 0 && <details><summary>Ignored · {scan.ignored.length} without race effects</summary><ul className="import-ignored">{scan.ignored.map(text => <li key={text}>{text}</li>)}</ul></details>}
      <button type="button" className="remove-scan" disabled={running} onClick={onRemove}>Remove scan</button>
    </div>
  </section>;
}
