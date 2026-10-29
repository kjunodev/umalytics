import { useEffect, useRef, useState } from 'react';
import { groundNames, weatherNames, seasonNames, type StaminaResult, type StaminaPoint } from './staminaTypes';

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
  const line = (key: 'full_spurt_percent' | 'survival_percent') => result.curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.stamina)} ${y(p[key])}`).join(' ');
  const inRange = result.current.stamina >= 600 && result.current.stamina <= 1400;
  return <svg className="stamina-chart" ref={ref} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="curve-title curve-description">
    <title id="curve-title">Full spurt and survival by stamina</title>
    <desc id="curve-description">Stamina from 600 to 1400; rates from 0 to 100 percent. Full spurt uses the plan in effect at the finish. Survival includes the goal-crossing engine tick. All rates are available in the table.</desc>
    {[0, 25, 50, 75, 100].map(value => <g key={value}><line className="grid-line" x1={40} x2={width - 20} y1={y(value)} y2={y(value)}/>{value % 50 === 0 && <text x={34} y={y(value) + 4} textAnchor="end">{value}%</text>}</g>)}
    {(width < 450 ? [600, 1000, 1400] : [600, 800, 1000, 1200, 1400]).map(value => <text key={value} x={x(value)} y={height - 4} textAnchor="middle">{value}</text>)}
    <line className="target-line" x1={40} x2={width - 20} y1={y(90)} y2={y(90)}/>
    <path className="curve-line" d={line('full_spurt_percent')}/><path className="curve-line survival-curve" d={line('survival_percent')}/>
    {inRange && <><line className="current-line" x1={x(result.current.stamina)} x2={x(result.current.stamina)} y1={20} y2={y(0)}/><circle className="current-dot" cx={x(result.current.stamina)} cy={y(result.current.full_spurt_percent)} r={5}/></>}
  </svg>;
}
const threshold = (value: number | null) => value === null ? '>2000' : value === 10 ? '≤10' : String(value);

export function StaminaResults({ result, course }: { result: StaminaResult; course: string }) {
  const [all, setAll] = useState(false);
  const points = [...result.curve.filter(p => p.stamina !== result.current.stamina), result.current].sort((a, b) => a.stamina - b.stamina);
  const anchors = [result.current.stamina, result.thresholds.full_spurt, result.thresholds.survival].filter((s): s is number => s !== null);
  const nearby = new Set([...points].sort((a, b) => Math.min(...anchors.map(s => Math.abs(a.stamina - s))) - Math.min(...anchors.map(s => Math.abs(b.stamina - s)))).slice(0, 6).map(p => p.stamina));
  const rows = all ? points : points.filter(p => nearby.has(p.stamina));
  const b = result.input.build;
  const currentRate = (key: keyof StaminaPoint) => Number(result.current[key]).toFixed(1);
  return <>
    <div className="kpis">
      <div className={`kpi ${result.current.full_spurt_percent >= 90 && result.current.survival_percent >= 90 ? 'sufficient' : 'insufficient'}`}><span className="label">Stamina {result.current.stamina}</span><b className="num">{currentRate('full_spurt_percent')}%</b><small>full spurt · {currentRate('survival_percent')}% survival · {result.current.seeds} seeds</small></div>
      <div className="kpi"><span className="label">90% full spurt</span><b className="num threshold-value">{threshold(result.thresholds.full_spurt)}</b><small>with selected skills</small></div>
      <div className="kpi"><span className="label">90% survival</span><b className="num threshold-value">{threshold(result.thresholds.survival)}</b><small>with selected skills</small></div>
    </div>
    <div className="panel effective-stamina"><h2 className="label">Effective stamina</h2><p><b className="num">{Math.round(result.effective_stamina)}</b> with selected heals · Needed: <b>{threshold(result.needed_effective_stamina.full_spurt)}</b> full spurt / <b>{threshold(result.needed_effective_stamina.survival)}</b> survival</p><small className="muted">Needed uses the build with heal skills removed. Equivalent assumes heals activate; overflow and late timing reduce their value.{result.heal_equivalents.some(h => h.variable) ? ' Variable heals use their base data value.' : ''}</small></div>
    <div className="panel chart-panel"><div className="chart-heading"><h2 className="label">Chance by stamina · 90% target</h2><div className="chart-legend"><span><i/>full spurt</span><span><i/>survival</span></div></div><Curve result={result}/></div>
    <div className="panel result-table"><div className="table-heading"><h2 className="label">{all ? 'All values' : 'Around your build'}</h2><button type="button" aria-pressed={all} onClick={() => setAll(!all)}>{all ? 'Around your build' : 'All values'}</button></div>
      <table><caption className="sr-only">Full spurt at finish and late entry; survival through goal-crossing tick</caption><thead><tr><th scope="col">Stamina</th><th scope="col">Full spurt</th><th scope="col">Survival</th><th scope="col">At entry</th></tr></thead><tbody>{rows.map(point => <tr key={point.stamina} title={`${point.seeds} seeds`} className={point.stamina === result.current.stamina ? 'current-row' : ''}><th scope="row" className="num">{point.stamina}</th><td className="num">{point.full_spurt_percent.toFixed(1)}%</td><td className="num">{point.survival_percent.toFixed(1)}%</td><td className="num">{point.full_spurt_at_entry_percent.toFixed(1)}%</td></tr>)}</tbody></table>
    </div>
    <details className="run-details"><summary>Run details</summary><p>{course}</p>
      <p>{groundNames[result.input.race.ground_condition - 1]} · {weatherNames[result.input.race.weather - 1]} · {seasonNames[result.input.race.season - 1]} · {['Front', 'Pace', 'Late', 'End'][b.running_style - 1]} · {result.input.field === 'pacemaker' ? 'Pacemaker (2 runners)' : 'Average lobby (9 runners)'}</p>
      <p>Speed {b.stats.speed}, Stamina {b.stats.stamina}, Power {b.stats.pow}, Guts {b.stats.guts}, Wit {b.stats.wiz}. {b.skills.length} skills · {['Awful', 'Bad', 'Normal', 'Good', 'Great'][b.motivation - 1]} mood.</p>
      <p>{result.races.toLocaleString()} races · {Math.min(32, result.seeds)} curve seeds · {result.seeds} threshold seeds · {(result.elapsed_ms / 1000).toFixed(2)} s · {result.ms_per_race.toFixed(2)} ms/race.</p>
      <p>Instance {result.course.race_instance_id} · {result.course.instance_reason} · {['', 'Morning', 'Daytime', 'Evening', 'Night'][result.course.time]} · race month {result.course.month}.</p>
      <p>Full spurt: retained engine plan is TRUE_EXCEED_NEED_MAX_HP at finish. At entry: first late-race plan, before later heal recalculations. Current lowest HP: {result.current.avg_min_hp.toFixed(1)} on average.</p>
      <p>Thresholds: conservative 90% crossing, refined to 10 stamina within 10–2000. Higher sampled values must also pass; raw rates can fluctuate. Each curve point uses at least 32 seeds; near thresholds up to the full seed bank. Estimates from finite samples, not confidence guarantees. Heal hybrids are removed entirely for needed effective stamina.</p>
    </details>
  </>;
}
