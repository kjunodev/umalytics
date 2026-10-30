import { useEffect, useRef, useState } from 'react';
import { groundNames, weatherNames, seasonNames, type StaminaResult, type CatalogSkill, roleNames, strategy } from './staminaTypes';

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
    <desc id="curve-description">Stamina from 600 to 1400; rates from 0 to 100 percent. Full spurt uses the plan in effect at the finish. Survival includes the goal-crossing engine tick. All rates are available in the table.</desc>
    {[0, 25, 50, 75, 100].map(value => <g key={value}><line className="grid-line" x1={40} x2={width - 20} y1={y(value)} y2={y(value)}/>{value % 50 === 0 && <text x={34} y={y(value) + 4} textAnchor="end">{value}%</text>}</g>)}
    {(width < 450 ? [600, 1000, 1400] : [600, 800, 1000, 1200, 1400]).map(value => <text key={value} x={x(value)} y={height - 4} textAnchor="middle">{value}</text>)}
    <line className="target-line" x1={40} x2={width - 20} y1={y(result.input.target)} y2={y(result.input.target)}/>
    <path className="curve-line" d={line('full_spurt_percent')}/><path className="curve-line survival-curve" d={line('survival_percent')}/>
    <path className="curve-line joint-curve" d={line('joint_percent')}/>
    {inRange && <><line className="current-line" x1={x(result.current.stamina)} x2={x(result.current.stamina)} y1={20} y2={y(0)}/><circle className="current-dot" cx={x(result.current.stamina)} cy={y(result.current.full_spurt_percent)} r={5}/></>}
  </svg>;
}
const number = (value: number) => Math.round(value).toLocaleString('en-US');
const threshold = (value: number | null) => value === null ? '>2,000' : value === 10 ? '≤10' : number(value);

export function StaminaResults({ result, course, skills }: { result: StaminaResult; course: string; skills: CatalogSkill[] }) {
  const points = [...result.curve.filter(p => p.stamina !== result.current.stamina), result.current].sort((a, b) => a.stamina - b.stamina);
  const b = result.input.build;
  const pass = result.thresholds.joint !== null && result.current.stamina >= result.thresholds.joint && result.current.joint_percent >= result.input.target;
  const needed = result.needed_effective_stamina.joint;
  return <>
    <div className={`kpi stamina-headline ${pass ? 'sufficient' : 'insufficient'}`}>
      <span className="label">{result.input.target}% full spurt + survival · same races</span>
      <div className="headline-answer"><b className="num">{needed === null ? 'Not reached' : threshold(needed)}</b><span>effective stamina needed</span><strong className="answer-state">{pass ? 'Pass' : 'Short'}</strong></div>
      <p>{needed === null ? `No joint ${result.input.target}% threshold found through 2,000 raw stamina` : `You need ${threshold(needed)} effective stamina`}; you have <strong>{number(result.effective_stamina)}</strong>.</p>
      <small>{result.current.joint_percent.toFixed(1)}% both at your build · {result.current.seeds} samples · raw threshold {threshold(result.thresholds.joint)} / yours {number(result.current.stamina)}</small>
    </div>
    <div className="kpis">
      <div className="kpi"><span className="label">{result.input.target}% full spurt</span><b className="num threshold-value">{threshold(result.needed_effective_stamina.full_spurt)}</b><small>effective · {threshold(result.thresholds.full_spurt)} raw · {result.current.full_spurt_percent.toFixed(1)}% at yours</small></div>
      <div className="kpi"><span className="label">{result.input.target}% survival</span><b className="num threshold-value">{threshold(result.needed_effective_stamina.survival)}</b><small>effective · {threshold(result.thresholds.survival)} raw · {result.current.survival_percent.toFixed(1)}% at yours</small></div>
      <div className="kpi heal-contributions"><span className="label">Heal equivalents at your build</span>{result.heal_equivalents.length ? result.heal_equivalents.map(h => <span key={h.skill_id}><strong className="num">+{number(h.stamina)}</strong> {skills.find(s => s.id === h.skill_id)?.name ?? `Skill ${h.skill_id}`}{h.variable ? ' (variable)' : ''}</span>) : <span className="muted">No healing skills selected</span>}</div>
    </div>
    <p className="simulation-mode muted">{result.input.assume_skills_activate ? 'Skill Wit checks assumed to pass' : 'Unconditional rates'} · {result.current.seeds} simulated</p>
    {!!result.heal_equivalents.length && <p className="muted heal-note">Effective stamina adds nominal heal equivalents at each measured stamina. Activation, overflow and timing can reduce their value; the simulation determines pass/short.{result.heal_equivalents.some(h => h.variable) ? ' Variable heals use their base data value.' : ''}</p>}
    <div className="panel chart-panel"><div className="chart-heading"><h2 className="label">Chance by raw stamina · {result.input.target}% target</h2><div className="chart-legend"><span><i/>full spurt</span><span><i/>survival</span><span><i/>joint</span></div></div><Curve result={result}/></div>
    <details className="panel result-table"><summary>Per-stamina table · {points.length} values</summary>
      <table><caption className="sr-only">Full spurt at finish; survival through goal-crossing tick; joint counts both in the same race</caption><thead><tr><th scope="col">Stamina</th><th scope="col">Full spurt</th><th scope="col">Survival</th><th scope="col">Joint</th><th scope="col">Samples</th></tr></thead><tbody>{points.map(point => <tr key={point.stamina} className={point.stamina === result.current.stamina ? 'current-row' : ''}><th scope="row" className="num">{point.stamina}</th><td className="num">{point.full_spurt_percent.toFixed(1)}%</td><td className="num">{point.survival_percent.toFixed(1)}%</td><td className="num">{point.joint_percent.toFixed(1)}%</td><td className="num">{point.seeds}</td></tr>)}</tbody></table>
    </details>
    <details className="run-details"><summary>Run details</summary><p>{course}</p>
      <p>{groundNames[result.input.race.ground_condition - 1]} · {weatherNames[result.input.race.weather - 1]} · {seasonNames[result.input.race.season - 1]} · {roleNames[strategy(b) - 1]} · {result.input.field === 'pacemaker' ? '2-runner (skill position conditions see 2 runners)' : result.input.field === 'mirror' ? 'Mirror (9 runners; opponents fixed to submitted stats)' : 'Average lobby (9 runners)'}</p>
      <p>Speed {b.stats.speed}, Stamina {b.stats.stamina}, Power {b.stats.pow}, Guts {b.stats.guts}, Wit {b.stats.wiz}. {b.skills.length} skills · {['Awful', 'Bad', 'Normal', 'Good', 'Great'][b.motivation - 1]} mood.</p>
      <p>{result.races.toLocaleString()} races · {Math.min(...result.curve.map(p => p.seeds))} curve samples · {result.seeds} threshold/current samples · {result.input.assume_skills_activate ? 'skill Wit checks assumed to pass' : 'unconditional'} · {(result.elapsed_ms / 1000).toFixed(2)} s · {result.ms_per_race.toFixed(2)} ms/race.</p>
      <p>Rushed {result.input.rushed ? 'On' : 'Off'} · Spot Struggle {result.input.spot_struggle ? 'On' : 'Off'} · Dueling {result.input.dueling ? 'On' : 'Off'} · Lane movement {result.input.lane_movement ? 'On' : 'Off'}.</p>
      <p>Instance {result.course.race_instance_id} · {result.course.instance_reason} · {['', 'Morning', 'Daytime', 'Evening', 'Night'][result.course.time]} · race month {result.course.month}.</p>
      <p>Full spurt: retained engine plan is TRUE_EXCEED_NEED_MAX_HP at finish. At entry: first late-race plan, before later heal recalculations. Current lowest HP: {result.current.avg_min_hp.toFixed(1)} on average.</p>
      <p>Thresholds: conservative {result.input.target}% crossing, refined to 10 stamina within 10–2000. Higher sampled values must also pass; raw rates can fluctuate. The curve begins with {Math.min(result.seeds, 32 * (result.input.target === 99 ? 10 : result.input.target === 95 ? 2 : 1))} samples. Thresholds and current stamina use the full bank. Every simulated seed counts. Estimates from finite samples, not confidence guarantees. Skill timing and position conditions still apply.</p>
    </details>
  </>;
}
