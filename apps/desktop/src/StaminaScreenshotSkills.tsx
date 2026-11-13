import { SkillIcon } from './SkillPicker';
import { hintDiscount, priceAfterTier, purchasePlan, selectTier, type ScreenshotImport, type SkillChain } from './staminaScreenshot';
import type { CatalogSkill } from './staminaTypes';

const format = (value: number) => value.toLocaleString('en-US');

export function StaminaScreenshotSkills({ scan, chains, skills, running, onChange, onRemove }: {
  scan: ScreenshotImport;
  chains: SkillChain[];
  skills: CatalogSkill[];
  running: boolean;
  onChange: (selected: number[]) => void;
  onRemove: () => void;
}) {
  const plan = purchasePlan(chains, scan.selected, scan.points);
  const meta = new Map(skills.map(skill => [skill.id, skill]));
  const name = (id: number) => meta.get(id)?.name ?? `Skill ${id}`;
  const identity = (id: number) => <span className="import-skill-name"><SkillIcon skill={meta.get(id)}/><span>{name(id)}</span>
    {meta.get(id)?.hp_recovery && <small>Recovery</small>}</span>;

  return <section className="screenshot-skills" aria-label="Screenshot skills">
    <header>{scan.points === null ? <h2>Finished Uma skills</h2> : <div className="import-budget" role="status">
        <strong className={plan.overBy ? 'import-warning' : undefined}>
          {plan.overBy ? `${format(plan.overBy)} SP over budget` : plan.left === null ? 'SP left unknown' : `${format(plan.left)} SP left`}
        </strong><small>{format(scan.points)} SP total</small>
      </div>}
    </header>
    {plan.overBy > 0 && <p className="import-warning">You can still run the check.</p>}
    {scan.points !== null && plan.left === null && <p className="import-warning">A selected price could not be calculated.</p>}
    <div className="import-skill-list">
      {chains.map(chain => {
        const steps = chain.steps.filter(step => step.selectable);
        const selected = steps.map(step => scan.selected.includes(step.id)).lastIndexOf(true);
        const base = name(chain.owned?.id ?? steps[0]!.id);
        return <div className="import-chain" key={chain.key}>
          <div className="import-tier-rows">
            {chain.steps.map(step => {
              const price = priceAfterTier(chain, step, steps[selected]?.id);
              return <div className="import-tier" key={step.id} data-selected={steps[selected]?.id === step.id}>
              <span className="import-tier-identity">{identity(step.id)}
                {step.hint && <small className="import-hint">{step.hint === 5 ? 'Hint Max' : `Hint Lv ${step.hint}`} · {hintDiscount(step.hint)}% off</small>}
              </span>
              {step.owned ? <span className="import-owned">Owned</span> : <span className="import-price">{price === null ? '— SP' : `${format(price)} SP`}</span>}
              {step.priceIssue && <small className="import-warning import-price-issue">{step.priceIssue}
                {(step.owned || price !== step.total) && step.total !== null && ` · Calculated ${format(step.total)} SP at scan`}
                {step.scanned.length ? ` · Scanned ${step.scanned.map(format).join(' / ')} SP` : ' · No scanned price'}
              </small>}
            </div>; })}
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
    <button type="button" className="remove-scan" onClick={onRemove}>Remove scan</button>
  </section>;
}
