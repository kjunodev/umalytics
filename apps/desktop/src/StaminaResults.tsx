import { useEffect, useRef, useState } from 'react';
import { formatStamina as number, higherTargetStamina, noRecoveryStamina, raceName, staminaMargin, staminaTableRows } from './staminaAnswers';
import { passes } from './staminaDraft';
import type { StaminaView } from './staminaState';
import { courseLabel, displaySkillName, groundNames, weatherNames, seasonNames, type StaminaResult, type CatalogSkill, roleNames, strategy } from './staminaTypes';

function Curve({ result }: { result: StaminaResult }) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(660);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0]!.contentRect.width)));
    observer.observe(ref.current!); return () => observer.disconnect();
  }, []);
  const height = 240;
  const x = (stamina: number) => 40 + (stamina - 600) / 800 * (width - 60);
  const y = (percent: number) => height - 24 - percent / 100 * (height - 44);
  const line = (key: 'full_spurt_percent' | 'survival_percent' | 'joint_percent') => result.curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.stamina)} ${y(p[key])}`).join(' ');
  const inRange = result.current.stamina >= 600 && result.current.stamina <= 1400;
  return <svg className="stamina-chart" ref={ref} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="curve-title curve-description">
    <title id="curve-title">Full spurt, survival and joint chance by stamina</title>
    <desc id="curve-description">Stamina from 600 to 1400. Full spurt uses the plan in effect at the finish. Survival includes the goal-crossing engine tick. The table shows the transition between zero and full rates.</desc>
    {[0, 25, 50, 75, 100].map(value => <g key={value}><line className="grid-line" x1={40} x2={width - 20} y1={y(value)} y2={y(value)}/>{value % 50 === 0 && <text x={34} y={y(value) + 4} textAnchor="end">{value}%</text>}</g>)}
    {(width < 450 ? [600, 1000, 1400] : [600, 800, 1000, 1200, 1400]).map(value => <text key={value} x={x(value)} y={height - 4} textAnchor="middle">{value}</text>)}
    <line className="target-line" x1={40} x2={width - 20} y1={y(result.input.target)} y2={y(result.input.target)}/>
    <path className="curve-line" d={line('full_spurt_percent')}/><path className="curve-line survival-curve" d={line('survival_percent')}/>
    <path className="curve-line joint-curve" d={line('joint_percent')}/>
    {inRange && <><line className="current-line" x1={x(result.current.stamina)} x2={x(result.current.stamina)} y1={20} y2={y(0)}/><circle className="current-dot" cx={x(result.current.stamina)} cy={y(result.current.full_spurt_percent)} r={5}/></>}
  </svg>;
}
const threshold = (value: number | null) => value === null ? '>2,000' : value === 10 ? '≤10' : number(value);
const effectiveDiffers = (raw: number | null, effective: number | null) =>
  raw !== null && effective !== null && Math.round(raw) !== Math.round(effective);
const detailViews = ['Summary', 'Chart', 'Table'] as const;

function StaminaTable({ result }: { result: StaminaResult }) {
  return <div className="result-table">
    <table aria-label="Per-stamina results">
      <thead><tr><th scope="col">Stamina</th><th scope="col">Full spurt</th><th scope="col">Survival</th><th scope="col">Joint</th><th scope="col">Samples</th></tr></thead>
      <tbody>{staminaTableRows(result.curve, result.current).map(point => point ?
        <tr key={point.stamina} className={point.stamina === result.current.stamina ? 'current-row' : undefined}>
          <th scope="row" className="num">{number(point.stamina)}</th>
          <td>{point.full_spurt_percent.toFixed(1)}%</td><td>{point.survival_percent.toFixed(1)}%</td>
          <td>{point.joint_percent.toFixed(1)}%</td><td>{point.seeds}</td>
        </tr> : <tr key="gap" className="stamina-table-gap"><td colSpan={5}><span aria-hidden="true">···</span><span className="sr-only">Outside the displayed stamina range</span></td></tr>
      )}</tbody>
    </table>
  </div>;
}

function StaminaScale({ you, need }: { you: number; need: number | null }) {
  const start = Math.min(600, Math.floor(you / 100) * 100, Math.floor((need ?? 600) / 100) * 100);
  const end = Math.max(1600, Math.ceil(you / 100) * 100, Math.ceil((need ?? 2000) / 100) * 100);
  const position = (value: number) => `${(value - start) / (end - start) * 100}%`;
  return <div className="stamina-scale">
    <div className="scale-track" aria-hidden="true">
      <i className="you-marker" style={{ left: position(you) }}/>
      {need !== null && <i className="need-marker" style={{ left: position(need) }}/>}
    </div>
    <div className="scale-endpoints" aria-hidden="true"><span>{number(start)}</span><span>{number(end)}</span></div>
    <div className="scale-labels"><span className="scale-you"><i aria-hidden="true"/> You <b>{number(you)}</b></span>
      <span className="scale-need"><i aria-hidden="true"/> Need <b>{threshold(need)}</b></span></div>
  </div>;
}

export function StaminaResults({ result, view, skills }: { result: StaminaResult; view: StaminaView; skills: CatalogSkill[] }) {
  const [detailView, setDetailView] = useState<typeof detailViews[number]>('Summary');
  const b = result.input.build;
  const need = result.thresholds.joint;
  const margin = staminaMargin(result);
  const pass = passes(result);
  const withoutRecoveries = noRecoveryStamina(result);
  const higherTarget = higherTargetStamina(result);
  const skillName = (id: number) => displaySkillName(skills.find(skill => skill.id === id)?.name ?? `Skill ${id}`);
  const recoveries = result.heal_equivalents.filter(heal => heal.stamina > 0).map(heal => skillName(heal.skill_id));
  const assessment = view === 'assessment';
  const race = raceName(result.course);
  const role = roleNames[strategy(b) - 1];
  return <>
    <div className={`panel stamina-headline ${assessment ? pass ? 'assessment-answer sufficient' : 'assessment-answer insufficient' : 'requirement-answer'}`}>
      {assessment ? <>
        <p className="answer-context">{race} · {result.input.target}% target</p>
        <h2>{pass ? margin ? `Enough, ${number(margin)} to spare` : 'Enough at the target' : margin !== null ? `${number(-margin)} short` : 'Below target'}</h2>
        <StaminaScale you={result.current.stamina} need={need}/>
        {margin !== null && margin < 0 && <div className="answer-chips"><span>Train {number(-margin)} more stamina</span></div>}
      </> : <>
        <p className="answer-context">To finish {race} with a full spurt {role === 'End' ? 'as an' : 'as a'} {role} in {result.input.target}% of races</p>
        <h2>{threshold(need)} <span>stamina</span></h2>
        <p className="assumed-recoveries">{recoveries.length ? `Assumes ${recoveries.join(', ')}` : 'No recoveries credited'}</p>
        {(withoutRecoveries !== null || higherTarget !== null) && <div className="answer-chips">
          {withoutRecoveries !== null && <span>Without recoveries · about <b>{number(withoutRecoveries)}</b></span>}
          {higherTarget !== null && <span>At 95% · about <b>{number(higherTarget)}</b></span>}
        </div>}
      </>}
    </div>
    <details className="run-details"><summary>Run details</summary>
      <div className="run-details-content">
        <div className="seg run-detail-views" role="group" aria-label="Run details view">{detailViews.map(name =>
          <button key={name} type="button" aria-pressed={name === detailView} onClick={() => setDetailView(name)}>{name}</button>)}</div>
        {detailView === 'Chart' ? <div className="panel chart-panel"><div className="chart-heading"><h2 className="label">Chance by raw stamina · {result.input.target}% target</h2><div className="chart-legend"><span><i/>full spurt</span><span><i/>survival</span><span><i/>joint</span></div></div><Curve result={result}/></div>
        : detailView === 'Table' ? <StaminaTable result={result}/> : <>
        <p>{courseLabel(result.course)}</p>
        <p>Combined at {result.input.target}% · {threshold(need)} stamina needed{effectiveDiffers(need, result.needed_effective_stamina.joint) && ` (${threshold(result.needed_effective_stamina.joint)} effective)`}.<br/>
          At your build · {number(result.current.stamina)} stamina{effectiveDiffers(result.current.stamina, result.effective_stamina) && ` (${number(result.effective_stamina)} effective)`}, {result.current.joint_percent.toFixed(1)}% combined from {result.current.seeds} samples.</p>
        <div className="kpis">
          {([{ key: 'full_spurt', label: 'full spurt', rate: result.current.full_spurt_percent },
            { key: 'survival', label: 'survival', rate: result.current.survival_percent }] as const).map(({ key, label, rate }) =>
            <div className="kpi" key={key}><span className="label">{result.input.target}% {label}</span><b className="num threshold-value">{threshold(result.thresholds[key])}</b>
              <small>{effectiveDiffers(result.thresholds[key], result.needed_effective_stamina[key]) && `${threshold(result.needed_effective_stamina[key])} effective · `}{rate.toFixed(1)}% at yours</small>
            </div>)}
          <div className="kpi heal-contributions"><span className="label">Heal equivalents at your build</span>{result.heal_equivalents.length ? result.heal_equivalents.map(h => <span key={h.skill_id} className={h.activation_rate === 0 ? 'heal-inactive' : undefined}><strong className="num">+{number(h.stamina)}</strong> {skillName(h.skill_id)}{h.variable ? ' (variable)' : ''}{h.activation_rate === 0 ? ' · Never fires in this race' : h.activation_rate < 1 ? ` · fires in ${Number((h.activation_rate * 100).toFixed(2))}% of races` : ''}</span>) : <span className="muted">No healing skills selected</span>}</div>
        </div>
        <p className="simulation-mode muted">{result.input.assume_skills_activate ? 'Skill Wit checks assumed to pass' : 'Unconditional rates'} · {result.current.seeds} simulated</p>
        {!!result.heal_equivalents.length && <p className="muted heal-note">Heal equivalents count each heal at the rate it fired in the simulation at your stamina. Course, slope, style and timing still affect activation.{result.heal_equivalents.some(h => h.variable) ? ' Variable heals use their base data value.' : ''}</p>}
        <p>{groundNames[result.input.race.ground_condition - 1]} · {weatherNames[result.input.race.weather - 1]} · {seasonNames[result.input.race.season - 1]} · {roleNames[strategy(b) - 1]} · {result.input.field === 'pacemaker' ? '2-runner (skill position conditions see 2 runners)' : result.input.field === 'mirror' ? 'Mirror (9 runners; opponents fixed to submitted stats)' : 'Average lobby (9 runners)'}</p>
        <p>Speed {b.stats.speed}, Stamina {b.stats.stamina}, Power {b.stats.pow}, Guts {b.stats.guts}, Wit {b.stats.wiz}. {b.skills.length} skills · {['Awful', 'Bad', 'Normal', 'Good', 'Great'][b.motivation - 1]} mood.</p>
        <p>{result.races.toLocaleString()} races · {Math.min(...result.curve.map(p => p.seeds))} curve samples · {result.seeds} threshold/current samples · {result.input.assume_skills_activate ? 'skill Wit checks assumed to pass' : 'unconditional'} · {(result.elapsed_ms / 1000).toFixed(2)} s · {result.ms_per_race.toFixed(2)} ms/race.</p>
        <p>Rushed {result.input.rushed ? 'On' : 'Off'} · Spot Struggle {result.input.spot_struggle ? 'On' : 'Off'} · Dueling {result.input.dueling ? 'On' : 'Off'} · Lane movement {result.input.lane_movement ? 'On' : 'Off'}.</p>
        <p>Instance {result.course.race_instance_id} · {result.course.instance_reason} · {['', 'Morning', 'Daytime', 'Evening', 'Night'][result.course.time]} · race month {result.course.month}.</p>
        <p>Full spurt: retained engine plan is TRUE_EXCEED_NEED_MAX_HP at finish. At entry: first late-race plan, before later heal recalculations. Short usually means HP runs out in the last ~60 m: the game plans the spurt to 60 m before the goal. Current lowest HP: {result.current.avg_min_hp.toFixed(1)} on average.</p>
        <p>Thresholds: conservative {result.input.target}% crossing, refined to 10 stamina within 10–2000. Higher sampled values must also pass; raw rates can fluctuate. The curve begins with {Math.min(result.seeds, 32 * (result.input.target === 99 ? 10 : result.input.target === 95 ? 2 : 1))} samples. Thresholds and current stamina use the full bank. Every simulated seed counts. Estimates from finite samples, not confidence guarantees. Skill timing and position conditions still apply.</p>
        </>}
      </div>
    </details>
  </>;
}
