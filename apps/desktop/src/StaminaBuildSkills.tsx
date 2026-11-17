import { useMemo, useState } from 'react';
import { SkillIcon, SkillPicker } from './SkillPicker';
import { availablePurchaseTiers, hintDiscount, priceAfterTier, purchaseList, purchasePlan, scanSkillIds, selectTier, type ScreenshotImport, type SkillChain, type TierStep } from './staminaScreenshot';
import type { Catalog, CatalogSkill, StaminaBuild } from './staminaTypes';

const format = (value: number) => value.toLocaleString('en-US');
const priceText = (value: number | null) => value === null ? 'Price unknown' : `${format(value)} SP`;
type BuildSkills = StaminaBuild['skills'];
const hint = (step?: TierStep) => step?.hint ? <small className="import-hint">{step.hint === 5 ? 'Hint Max' : `Hint Lv ${step.hint}`} · {hintDiscount(step.hint)}% off</small> : null;

export function StaminaBuildSkills({ catalog, scan, chains, skills, uniques, recent, running, notice, onRecent, onScan, onRemoveScan, onManual, onLevel }: {
  catalog: Catalog;
  scan?: ScreenshotImport;
  chains: SkillChain[];
  skills: BuildSkills;
  uniques: { skill: BuildSkills[number]; meta: CatalogSkill }[];
  recent: number[];
  running: boolean;
  notice: boolean;
  onRecent: (ids: number[]) => void;
  onScan: (scan: ScreenshotImport) => void;
  onRemoveScan: () => void;
  onManual: (skills: BuildSkills) => void;
  onLevel: (id: number, level: number) => void;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const plan = purchasePlan(chains, scan?.selected ?? [], scan?.points ?? null);
  const scannedIds = useMemo(() => scanSkillIds(chains, catalog.screenshot_skills ?? {}), [chains, catalog]);
  const searchCatalog = useMemo(() => ({ ...catalog, skills: catalog.skills.filter(skill => !scannedIds.has(skill.id)) }), [catalog, scannedIds]);
  const meta = new Map(catalog.skills.map(skill => [skill.id, skill]));
  const name = (id: number) => meta.get(id)?.name ?? `Skill ${id}`;
  const identity = (id: number, removal = false) => <span className="import-skill-name"><SkillIcon skill={meta.get(id)}/><span>{removal ? 'Remove ' : ''}{name(id)}</span>
    {meta.get(id)?.hp_recovery && <small>Recovery</small>}</span>;
  const manual = skills.filter(skill => !scannedIds.has(skill.id));
  const owned = chains.flatMap(chain => {
    if (!chain.owned || uniques.some(({ skill }) => skill.id === chain.owned?.id)) return [];
    return [{ skill: chain.owned, step: chain.steps.find(step => step.id === chain.owned?.id && step.owned), removal: chain.steps.find(step => step.removal) }];
  });
  const offers = chains.flatMap(chain => {
    const steps = chain.steps.filter(step => step.selectable);
    if (!steps.length) return [];
    const purchase = plan.purchases.find(step => steps.includes(step));
    return [{ chain, steps, purchase, available: availablePurchaseTiers(chain, purchase) }];
  });
  const stepper = ({ chain, steps, purchase }: typeof offers[number]) => {
    const selected = purchase ? steps.indexOf(purchase) : -1;
    const base = name(chain.owned?.id ?? steps[0]!.id);
    const changeTier = (id?: number) => {
      setCopyStatus('');
      if (scan) onScan({ ...scan, selected: selectTier(scan.selected, chain, id) });
    };
    return <div className="import-stepper" role="group" aria-label={`Purchase tier for ${base}`}>
      <button type="button" aria-label={`Decrease tier for ${base}`} disabled={selected < 0} onClick={() => changeTier(steps[selected - 1]?.id)}>−</button>
      <span>{selected < 0 ? 'None' : `${selected + 1} / ${steps.length}`}</span>
      <button type="button" aria-label={`Increase tier for ${base}`}
        disabled={selected === steps.length - 1 || ((!chain.owned || purchase?.removal) && skills.length + uniques.length >= 100)}
        onClick={() => changeTier(steps[selected + 1]?.id)}>+</button>
    </div>;
  };
  const tierRow = (chain: SkillChain, step: TierStep, price: number | null) => <div className="import-tier" key={step.id}>
    <span className="import-tier-identity">{identity(step.id, step.removal)}{hint(step)}</span>
    <span className="import-price">{priceText(price)}</span>
    {step.inferredFrom !== undefined && <small className="muted import-price-issue">Price from {name(step.inferredFrom)}'s row</small>}
    {step.estimated && <small className="import-warning import-price-issue">Estimated upgrade price after removing {name(chain.owned!.id)}</small>}
    {step.priceIssue && <small className="import-warning import-price-issue">{step.priceIssue}
      {price !== step.total && step.total !== null && ` · Calculated ${format(step.total)} SP at scan`}
      {step.scanned.length ? ` · Scanned ${step.scanned.map(format).join(' / ')} SP` : ' · No scanned price'}
    </small>}
  </div>;
  const purchases = plan.purchases.length;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(purchaseList(plan.purchases, name));
      setCopyStatus('List copied');
    } catch { setCopyStatus('Unable to copy list'); }
  };

  return <>
    {scan && scan.points !== null && <div className={`import-budget${plan.overBy ? ' import-warning' : ''}`} role="status">
      <strong>{plan.left === null ? 'Unknown' : format(plan.left)} / {format(scan.points)} SP left</strong>
      {plan.overBy > 0 && <small>{format(plan.overBy)} SP over budget</small>}
      {plan.left === null && <small>A selected price could not be calculated.</small>}
    </div>}
    <div className="skills-scroll" aria-label="Skills"><fieldset disabled={running} className="build-controls">
      {notice && <small className="muted" role="status">Local skill data unavailable. Using engine names without icons.</small>}
      <section className="skills-group" aria-label="Owned">
        <h3>Owned</h3>
        {uniques.map(({ skill, meta }) => <div className="build-skill-row" key={skill.id}>{identity(skill.id)}
          <label className="skill-level">Lv<select aria-label={`${meta.name} level`} value={skill.level} onChange={event => onLevel(skill.id, Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(level => <option key={level}>{level}</option>)}</select></label>
        </div>)}
        {owned.map(({ skill, step, removal }) => <div className="build-skill-row" key={skill.id}>
          <span className="import-tier-identity">{identity(skill.id)}{hint(step)}</span>
          {removal && <span className="import-price">Remove · {priceText(removal.total)}</span>}
        </div>)}
        {manual.map(skill => <div className="build-skill-row" key={skill.id}>{identity(skill.id)}
          <button type="button" className="remove-manual-skill" aria-label={`Remove skill ${skill.id}`} onClick={() => onManual(manual.filter(item => item.id !== skill.id))}>×</button>
        </div>)}
        {!uniques.length && !owned.length && !manual.length && <p className="muted">No skills added.</p>}
      </section>
      {scan && scan.points !== null && <>
        <section className="skills-group" aria-label="Buying">
          <header><div><h3>Buying</h3><small>{purchases} {purchases === 1 ? 'skill' : 'skills'} · {priceText(plan.spent)}</small></div>
            <button type="button" disabled={!purchases} onClick={() => { void copy(); }}>Copy list</button></header>
          <div className="import-skill-list">{offers.map(offer => offer.purchase && <div className="import-chain" key={offer.chain.key}>
            {tierRow(offer.chain, offer.purchase, offer.purchase.total)}
            {!offer.available.length && stepper(offer)}
          </div>)}</div>
          {copyStatus && <small role="status">{copyStatus}</small>}
        </section>
        <section className="skills-group" aria-label="Available">
          <h3>Available</h3>
          <div className="import-skill-list">{offers.map(offer => offer.available.length > 0 && <div className="import-chain" key={offer.chain.key}>
            <div>{offer.available.map(step => tierRow(offer.chain, step, priceAfterTier(offer.chain, step, offer.purchase?.id)))}</div>
            {stepper(offer)}
          </div>)}</div>
        </section>
      </>}
      <SkillPicker catalog={searchCatalog} showSelected={false} addLabel="Add any skill" skills={manual} recent={recent} onRecent={onRecent}
        limit={100 - uniques.length - (skills.length - manual.length)} onChange={onManual}/>
      {scan && <div className="scan-actions">
        {scan.ignored.length > 0 && <details><summary>Ignored · {scan.ignored.length} without race effects</summary>
          <ul className="import-ignored">{scan.ignored.map(text => <li key={text}>{text}</li>)}</ul>
        </details>}
        <button type="button" className="remove-scan" onClick={onRemoveScan}>Remove scan</button>
      </div>}
    </fieldset></div>
  </>;
}
