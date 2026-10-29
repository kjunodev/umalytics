import { useEffect, useRef, useState } from 'react';
import type { StaminaResult } from './staminaTypes';

function Curve({ result }: { result: StaminaResult }) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(660);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0]!.contentRect.width)));
    observer.observe(ref.current!); return () => observer.disconnect();
  }, []);
  const height = 240;
  const x = (stamina: number) => 40 + (stamina - 300) / 1700 * (width - 60);
  const y = (percent: number) => height - 24 - percent / 100 * (height - 44);
  const line = result.curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.stamina)} ${y(p.no_hp_out_percent)}`).join(' ');
  return <svg className="stamina-chart" ref={ref} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="curve-title curve-description">
    <title id="curve-title">Chance to finish without running out, by stamina</title>
    <desc id="curve-description">Stamina from 300 to 2000, no HP-out from 0 to 100 percent. Your tested stamina {result.current.stamina}: {result.current.no_hp_out_percent.toFixed(1)} percent. {result.threshold === null ? '95 percent was not reached.' : `95 percent threshold: ${result.threshold}.`} All sampled values are available in the table below.</desc>
    {[0, 25, 50, 75, 100].map(value => <g key={value}><line className="grid-line" x1={40} x2={width - 20} y1={y(value)} y2={y(value)}/>{value % 50 === 0 && <text x={34} y={y(value) + 4} textAnchor="end">{value}%</text>}</g>)}
    {(width < 450 ? [300, 1000, 2000] : [300, 700, 1000, 1200, 1600, 2000]).map(value => <text key={value} x={x(value)} y={height - 4} textAnchor="middle">{value}</text>)}
    <line className="target-line" x1={40} x2={width - 20} y1={y(95)} y2={y(95)}/>
    <path className="curve-fill" d={`${line} L${x(2000)} ${y(0)} L${x(300)} ${y(0)} Z`}/><path className="curve-line" d={line}/>
    <line className="current-line" x1={x(result.current.stamina)} x2={x(result.current.stamina)} y1={20} y2={y(0)}/>
    {result.threshold !== null && <line className="threshold-line" x1={x(result.threshold)} x2={x(result.threshold)} y1={20} y2={y(0)}/>}
    <circle className="current-dot" cx={x(result.current.stamina)} cy={y(result.current.no_hp_out_percent)} r={5}/>
  </svg>;
}

export function StaminaResults({ result, course }: { result: StaminaResult; course: string }) {
  const [all, setAll] = useState(false);
  // Include off-grid current stamina without treating it as a tested threshold.
  const points = [...result.curve.filter(p => p.stamina !== result.current.stamina), result.current].sort((a, b) => a.stamina - b.stamina);
  const currentIndex = points.findIndex(p => p.stamina === result.current.stamina);
  const thresholdIndex = points.findIndex(p => p.stamina === result.threshold);
  const nearIndexes = new Set<number>();
  for (const anchor of [currentIndex, thresholdIndex].filter(i => i >= 0)) for (const offset of [0, -1, 1]) {
    const index = anchor + offset; if (index >= 0 && index < points.length) nearIndexes.add(index);
  }
  const closest = points.map((_, index) => index).sort((a, b) => Math.abs(a - currentIndex) - Math.abs(b - currentIndex));
  for (const index of closest) { if (nearIndexes.size >= 6) break; nearIndexes.add(index); }
  const near = [...nearIndexes].sort((a, b) => a - b).map(index => points[index]!);
  const rows = all ? points : near;
  const gap = result.threshold === null ? null : Math.max(0, result.threshold - result.current.stamina);
  return <>
    <div className="kpis"><div className={`kpi ${result.current.no_hp_out_percent >= 95 ? 'sufficient' : 'insufficient'}`}><span className="label">Stamina {result.current.stamina}</span><b className="num">{result.current.no_hp_out_percent.toFixed(1)}%</b><small>finish without running out</small></div><div className="kpi"><span className="label">95% needs</span><b className="num threshold-value">{result.threshold ?? '—'}</b><small>{result.threshold === null ? 'not reached in 300–2000' : 'smallest tested value'}</small></div><div className="kpi"><span className="label">Gap</span><b className="num">{gap ? `+${gap}` : '—'}</b><small>stamina, or more recovery</small></div></div>
    <div className="panel chart-panel"><div className="chart-heading"><h2 className="label">Chance to finish without running out, by stamina</h2><div className="chart-legend"><span><i/>you</span><span><i/>95% point</span></div></div><Curve result={result}/></div>
    <div className="panel result-table"><div className="table-heading"><h2 className="label">{all ? 'All values' : 'Around your build'}</h2><button type="button" aria-pressed={all} onClick={() => setAll(!all)}>{all ? 'Around your build' : 'All values'}</button></div>
      <table><caption className="sr-only">No HP-out through the goal-crossing engine tick</caption><thead><tr><th scope="col">Stamina</th><th scope="col">No HP-out</th><th scope="col">Avg lowest HP</th></tr></thead><tbody>{rows.map(point => <tr key={point.stamina} className={`${point.stamina === result.current.stamina ? 'current-row' : ''} ${point.stamina === result.threshold ? 'threshold-row' : ''}`}><th scope="row" className="num">{point.stamina}<span className="sr-only">{point.stamina === result.current.stamina ? ' current' : ''}{point.stamina === result.threshold ? ' 95% threshold' : ''}</span></th><td className="num">{point.no_hp_out_percent.toFixed(1)}%</td><td className="num">{point.avg_min_hp.toFixed(1)}</td></tr>)}</tbody></table>
    </div>
    <details className="run-details"><summary>Run details</summary><p>{course}</p><p>{['Good', 'Soft', 'Hard', 'Bad'][result.input.ground_condition - 1]} · {['Sunny', 'Cloudy', 'Rainy', 'Snow'][result.input.weather - 1]} · {['Spring', 'Summer', 'Fall', 'Winter', 'Cherry Blossom'][result.input.season - 1]} · {['Front', 'Pace', 'Late', 'End'][result.input.running_style - 1]}</p>
      <p>Build: Speed {result.input.stats.speed}, Stamina {result.input.stats.stamina}, Power {result.input.stats.pow}, Guts {result.input.stats.guts}, Wit {result.input.stats.wiz}.</p>
      <p>{result.input.skills.length} skills · Mood {['Awful', 'Bad', 'Normal', 'Good', 'Great'][result.input.motivation - 1]}</p>
      <p>{result.races.toLocaleString()} races · {result.seeds} seeds per stamina · {(result.elapsed_ms / 1000).toFixed(2)} s · {result.ms_per_race.toFixed(2)} ms/race · Race instance {result.race_instance_id}</p><p>Smallest tested threshold; finite-sample estimate.</p></details>
  </>;
}
