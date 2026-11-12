import { SkillIcon } from './SkillPicker';
import { purchasePlan, selectTier, type ScreenshotImport, type SkillChain } from './staminaScreenshot';
import type { CatalogSkill } from './staminaTypes';

const format = (value: number) => value.toLocaleString('en-US');

export function StaminaScreenshotSkills({ scan, chains, skills, running, onChange }: {
  scan: ScreenshotImport;
  chains: SkillChain[];
  skills: CatalogSkill[];
  running: boolean;
  onChange: (selected: number[]) => void;
}) {
  const plan = purchasePlan(chains, scan.selected, scan.points);
  const meta = new Map(skills.map(skill => [skill.id, skill]));
  const name = (id: number) => meta.get(id)?.name ?? `Skill ${id}`;
  const ordered = [...chains].sort((a, b) => {
    const available = (chain: SkillChain) => chain.steps.some(step => step.selectable);
    const label = (chain: SkillChain) => name(chain.owned?.id ?? chain.steps[0]!.id);
    return Number(available(b)) - Number(available(a)) || label(a).localeCompare(label(b));
  });
  const identity = (id: number) => <span className="import-skill-name"><SkillIcon skill={meta.get(id)}/><span>{name(id)}</span>
    {meta.get(id)?.hp_recovery && <small>Recovery</small>}</span>;

  return <section className="panel screenshot-skills" aria-label="Screenshot skills">
    <header><h2>Screenshot skills</h2><strong className={plan.overBudget ? 'import-warning' : undefined} role="status">
      {plan.left === null ? '?' : format(plan.left)} / {format(scan.points)} SP left
    </strong></header>
    {plan.overBudget && <p className="import-warning">Over budget · You can still run the check.</p>}
    {plan.left === null && <p className="import-warning">A selected price could not be calculated.</p>}
    <div className="import-skill-list">
      {ordered.map(chain => {
        const steps = chain.steps.filter(step => step.selectable);
        const selected = steps.map(step => scan.selected.includes(step.id)).lastIndexOf(true);
        const base = name(chain.owned?.id ?? steps[0]!.id);
        return <div className="import-chain" key={chain.key}>
          <div className="import-tier-rows">
            {chain.owned && <div className="import-tier">
              {identity(chain.owned.id)}<span className="import-owned">Owned</span>
            </div>}
            {chain.steps.map(step => <div className="import-tier" key={step.id} data-selected={steps[selected]?.id === step.id}>
              {step.selectable && <>{identity(step.id)}<span className="import-price">{step.total === null ? '— SP' : `${format(step.total)} SP`}</span></>}
              {step.priceIssue && <small className="import-warning import-price-issue">{step.priceIssue}
                {!step.selectable && ` · ${name(step.id)}${step.total === null ? '' : ` · Calculated ${format(step.total)} SP`}`}
                {step.scanned.length ? ` · Scanned ${step.scanned.map(format).join(' / ')} SP` : ' · No scanned price'}
              </small>}
            </div>)}
          </div>
          {!!steps.length && <div className="import-stepper" role="group" aria-label={`Purchase tier for ${base}`}>
            <button type="button" aria-label={`Decrease tier for ${base}`} disabled={running || selected < 0}
              onClick={() => onChange(selectTier(scan.selected, chain, steps[selected - 1]?.id))}>−</button>
            <span>{selected < 0 ? 'None' : `${selected + 1} / ${steps.length}`}</span>
            <button type="button" aria-label={`Increase tier for ${base}`}
              disabled={running || selected === steps.length - 1 || (!chain.owned && selected < 0 && plan.skills.length >= 100)}
              onClick={() => onChange(selectTier(scan.selected, chain, steps[selected + 1]?.id))}>+</button>
          </div>}
        </div>;
      })}
    </div>
    {scan.ignored.length > 0 && <details><summary>Ignored · {scan.ignored.length} without race effects</summary>
      <ul className="import-ignored">{scan.ignored.map(text => <li key={text}>{text}</li>)}</ul>
    </details>}
  </section>;
}
