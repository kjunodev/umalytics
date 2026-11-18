import type { ReactNode } from 'react';
import { HpAmounts, SkillIcon } from './SkillPicker';
import { shopPrice } from './StaminaSkillShop';
import { hintDiscount, purchasePlan, type ScreenshotImport, type SkillChain } from './staminaScreenshot';
import { displaySkillName, type Catalog, type CatalogSkill, type StaminaBuild } from './staminaTypes';

type BuildSkills = StaminaBuild['skills'];

export function StaminaBuildSkills({ catalog, scan, chains, manual, uniques, plan, running, notice, manualPicker, onOpenShop, onRemoveScan, onManual, onLevel }: {
  catalog: Catalog;
  scan?: ScreenshotImport;
  chains: SkillChain[];
  manual: BuildSkills;
  uniques: { skill: BuildSkills[number]; meta: CatalogSkill }[];
  plan: ReturnType<typeof purchasePlan>;
  running: boolean;
  notice: boolean;
  manualPicker: ReactNode;
  onOpenShop?: () => void;
  onRemoveScan: () => void;
  onManual: (skills: BuildSkills) => void;
  onLevel: (id: number, level: number) => void;
}) {
  const meta = new Map(catalog.skills.map(skill => [skill.id, skill]));
  const name = (id: number) => displaySkillName(meta.get(id)?.name ?? `Skill ${id}`);
  const identity = (id: number, removal = false) => {
    const skill = meta.get(id);
    const hp = removal ? [] : catalog.hp_effects?.[id] ?? [];
    return <span className="import-skill-name"><SkillIcon skill={skill}/><span>{removal ? 'Remove ' : ''}{name(id)}</span>
      {!removal && (skill?.hp_recovery || hp.some(effect => effect.value > 0)) && <small>Recovery</small>}
      {hp.some(effect => effect.value < 0) && <small className="import-warning">Drain</small>}
      {hp.length > 0 && <HpAmounts effects={hp}/>}
    </span>;
  };
  const owned = chains.flatMap(chain => {
    if (!chain.owned || uniques.some(({ skill }) => skill.id === chain.owned?.id)) return [];
    return [{ skill: chain.owned, step: chain.steps.find(step => step.id === chain.owned?.id && step.owned), removal: chain.steps.find(step => step.removal) }];
  });
  const ordinaryNames = new Set([...owned.map(({ skill }) => name(skill.id)), ...manual.map(skill => name(skill.id))]);
  const preview = plan.purchases.slice(0, 3);
  return <div className="skills-scroll" aria-label="Skills"><fieldset disabled={running} className="build-controls">
    {notice && <small className="muted" role="status">Local skill data unavailable. Using engine names without icons.</small>}
    <section className="skills-group" aria-label="Owned">
      <h3>Owned</h3>
      {uniques.map(({ skill }) => <div className="build-skill-row" key={skill.id}>{identity(skill.id)}
        <label className="skill-level">{ordinaryNames.has(name(skill.id)) && <span>Unique</span>} Lv<select aria-label={`${name(skill.id)} level`} value={skill.level} onChange={event => onLevel(skill.id, Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(level => <option key={level}>{level}</option>)}</select></label>
      </div>)}
      {owned.map(({ skill, step, removal }) => <div className="build-skill-row" key={skill.id}>
        <span className="import-tier-identity">{identity(skill.id)}
          {step?.hint ? <small className="import-hint">{step.hint === 5 ? 'Hint Max' : `Hint Lv ${step.hint}`} · {hintDiscount(step.hint)}% off</small> : null}
        </span>
        {removal && <span className="import-price">Remove · {shopPrice(removal.total)}</span>}
      </div>)}
      {manual.map(skill => <div className="build-skill-row" key={skill.id}>{identity(skill.id)}
        <button type="button" className="remove-manual-skill" aria-label={`Remove skill ${skill.id}`} onClick={() => onManual(manual.filter(item => item.id !== skill.id))}>×</button>
      </div>)}
      {!uniques.length && !owned.length && !manual.length && <p className="muted">No skills added.</p>}
    </section>
    {onOpenShop ? <>
      {preview.length > 0 && <section className="skills-group" aria-label="Buying">
        <h3>Buying</h3>
        {preview.map(step => <div className="build-skill-row" key={step.id}>{identity(step.id, step.removal)}<span className="import-price">{shopPrice(step.total)}</span></div>)}
        {preview.length < plan.purchases.length && <small>{plan.purchases.length - preview.length} more</small>}
      </section>}
      <button type="button" className="open-skill-shop" onClick={onOpenShop}>Open skill shop</button>
    </> : <>
      {manualPicker}
      {scan && <div className="scan-actions">
        {scan.ignored.length > 0 && <details><summary>Ignored · {scan.ignored.length} without race effects</summary>
          <ul className="import-ignored">{scan.ignored.map(text => <li key={text}>{displaySkillName(text)}</li>)}</ul>
        </details>}
        <button type="button" className="remove-scan" onClick={onRemoveScan}>Remove scan</button>
      </div>}
    </>}
  </fieldset></div>;
}
