import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { StaminaResults } from './StaminaResults';
import { courseLabel, defaultStaminaInput, groundNames, weatherNames, seasonNames, type Catalog, type StaminaBuild, type StaminaInput, type StaminaProgress, type StaminaResult } from './staminaTypes';

const styles = ['Front Runner', 'Pace Chaser', 'Late Surger', 'End Closer'];
const grades = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];

function Picker({ label, value, options, onChange }: {
  label: string; value: number; options: string[]; onChange: (value: number) => void;
}) {
  return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(Number(event.target.value))}>
    {options.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
  </select></label>;
}

function Segments({ label, value, options, onChange }: { label: string; value: number; options: string[]; onChange: (value: number) => void }) {
  return <div className="field"><span>{label}</span><div className="seg" role="group" aria-label={label}>{options.map((name, i) => <button type="button" key={name} aria-pressed={value === i + 1} onClick={() => onChange(i + 1)}>{name}</button>)}</div></div>;
}

export function Stamina() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [input, setInput] = useState<StaminaInput>(defaultStaminaInput);
  const [skillSearch, setSkillSearch] = useState('');
  const [skillId, setSkillId] = useState('');
  const [addingSkill, setAddingSkill] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<StaminaProgress>();
  const [result, setResult] = useState<{ data: StaminaResult; course: string }>();
  const active = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let stop: UnlistenFn | undefined;
    void (async () => {
      stop = await listen<StaminaProgress>('stamina-progress', ({ payload }) => {
        if (payload.request_id === active.current) {
          setProgress(previous => ({ ...payload, completed: Math.max(previous?.completed ?? 0, payload.completed), total: Math.max(previous?.total ?? 0, payload.total) }));
        }
      });
      if (disposed) { stop(); return; }
      const data = await invoke<Catalog>('engine_catalog');
      if (!disposed) { setCatalog(data); setReady(true); }
    })().catch(reason => { if (!disposed) setError(String(reason)); });
    return () => {
      disposed = true;
      stop?.();
      if (active.current) void invoke('cancel_stamina_check').catch(() => {});
      active.current = null;
    };
  }, []);

  const patch = (next: Partial<StaminaInput>) => setInput(previous => ({ ...previous, ...next }));
  const patchBuild = (next: Partial<StaminaBuild>) => patch({ build: { ...input.build, ...next } });
  const patchRace = (next: Partial<StaminaInput['race']>) => patch({ race: { ...input.race, ...next } });
  const run = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request_id = crypto.randomUUID();
    const build = { ...input, request_id };
    active.current = request_id;
    setRunning(true); setCancelling(false); setProgress(undefined); setError(''); setResult(undefined);
    try {
      const data = await invoke<StaminaResult>('stamina_check', { input: build });
      if (active.current === request_id) setResult({ data,
        course: courseLabel(catalog!.courses.find(course => course.id === data.input.race.map_id)!) });
    } catch (reason) {
      if (active.current === request_id) setError(String(reason));
    } finally {
      if (active.current === request_id) { active.current = null; setRunning(false); setCancelling(false); }
    }
  };
  const cancel = async () => {
    setCancelling(true);
    try { await invoke('cancel_stamina_check'); }
    catch (reason) { setError(String(reason)); setCancelling(false); }
  };
  const selectedCourse = catalog?.courses.find(course => course.id === input.race.map_id);
  const availableSkills = catalog?.skills.filter(skill =>
    !input.build.skills.some(selected => selected.id === skill.id) &&
    `${skill.name} ${skill.id}`.toLowerCase().includes(skillSearch.toLowerCase())) ?? [];

  const seedBudget = input.seeds ?? (input.build.skills.some(s => catalog?.skills.some(skill => skill.id === s.id && skill.hp_recovery)) ? 1000 : 256);
  const distanceIndex = !selectedCourse ? 2 : selectedCourse.distance <= 1400 ? 0 : selectedCourse.distance <= 1800 ? 1 : selectedCourse.distance <= 2400 ? 2 : 3;
  const surfaceIndex = selectedCourse?.surface === 2 ? 1 : 0;
  const aptitude = (group: 'distance' | 'style' | 'ground', index: number, label: string) => <Picker label={label} value={input.build[group][index]!} options={grades} onChange={value => {
    const values = [...input.build[group]]; values[index] = value; patchBuild({ [group]: values });
  }}/>;
  return <section aria-label="Stamina check" className="stamina-layout">
    <form className="panel stamina-form" aria-label="Build and race" onSubmit={event => { void run(event); }}>
      <fieldset disabled={!ready || running}>
        <div className="field"><span>Track</span><div className="course-chips" role="group" aria-label="Track">
          {[...new Set(catalog?.courses.map(course => course.track_name))].map(track => <button type="button" key={track} aria-pressed={selectedCourse?.track_name === track} onClick={() => patchRace({ map_id: catalog!.courses.find(course => course.track_name === track)!.id })}>{track}</button>)}
        </div></div>
        <div className="field"><span>Distance · surface · variant</span><div className="course-chips" role="group" aria-label="Race">
          {catalog?.courses.filter(course => course.track_name === selectedCourse?.track_name).map(course => <button type="button" key={course.id} title={course.unavailable_reason ?? undefined} aria-pressed={input.race.map_id === course.id} onClick={() => patchRace({ map_id: course.id })}>{course.distance} · {course.surface === 1 ? 'Turf' : 'Dirt'}{course.variant ? ` · ${course.variant}` : ''}{course.unavailable_reason ? ' · Unavailable' : ''}</button>)}
        </div></div>
        {selectedCourse && <small className="muted">{courseLabel(selectedCourse)}</small>}
        {selectedCourse?.unavailable_reason && <small role="status">{selectedCourse.unavailable_reason}</small>}
        <Segments label="Ground" value={input.race.ground_condition} options={groundNames} onChange={ground_condition => patchRace({ ground_condition })}/>
        <Segments label="Weather" value={input.race.weather} options={weatherNames} onChange={weather => patchRace({ weather })}/>
        <Segments label="Season" value={input.race.season} options={seasonNames} onChange={season => patchRace({ season })}/>
        <div className="field"><span>Field</span><div className="seg" role="group" aria-label="Field">{(['pacemaker', 'average_lobby'] as const).map(field => <button type="button" key={field} aria-pressed={input.field === field} onClick={() => patch({ field })}>{field === 'pacemaker' ? 'Pacemaker' : 'Average lobby'}</button>)}</div></div>
        <div className="field"><span>Strategy</span><div className="seg" role="group" aria-label="Strategy">{['Front', 'Pace', 'Late', 'End'].map((style, i) => <button type="button" key={style} aria-pressed={input.build.running_style === i + 1} onClick={() => patchBuild({ running_style: i + 1 })}>{style}</button>)}</div></div>
        <div className="raw-stats">{(Object.keys(input.build.stats) as (keyof StaminaBuild['stats'])[]).map(stat => <label key={stat}>{({ speed: 'Spd', stamina: 'Sta', pow: 'Pow', guts: 'Guts', wiz: 'Wit' })[stat]}
          <input className={`num ${stat === 'stamina' ? 'stamina-input' : ''}`} aria-label={stat === 'pow' ? 'Power' : stat === 'wiz' ? 'Wit' : stat[0]!.toUpperCase() + stat.slice(1)} type="number" required min={1} max={2000} value={input.build.stats[stat]} onChange={event => patchBuild({ stats: { ...input.build.stats, [stat]: Number(event.target.value) } })}/></label>)}</div>
        <div className="field"><span>Aptitudes · distance / strategy / surface</span><div className="aptitude-summary">
          {aptitude('distance', distanceIndex, ['Sprint', 'Mile', 'Medium', 'Long'][distanceIndex]!)}
          {aptitude('style', input.build.running_style - 1, ['Front', 'Pace', 'Late', 'End'][input.build.running_style - 1]!)}
          {aptitude('ground', surfaceIndex, surfaceIndex ? 'Dirt' : 'Turf')}
          <Picker label="Mood" value={input.build.motivation} options={['Awful', 'Bad', 'Normal', 'Good', 'Great']} onChange={motivation => patchBuild({ motivation })}/>
        </div></div>
        <details className="edit-all"><summary>Edit all aptitudes</summary>
          {(['distance', 'style', 'ground'] as const).map(group => <div className="aptitude-grid" key={group}>{({ distance: ['Sprint', 'Mile', 'Medium', 'Long'], style: styles, ground: ['Turf', 'Dirt'] })[group].map((name, i) => <div key={name}>{aptitude(group, i, `${name} aptitude`)}</div>)}</div>)}

        </details>
        <div className="field"><span>Recovery skills (your uma only)</span><div className="skill-chips">{input.build.skills.map(skill => <span className="skill-chip" key={skill.id}><span>{catalog?.skills.find(s => s.id === skill.id)?.name ?? skill.id}</span><button type="button" aria-label={`Remove skill ${skill.id}`} onClick={() => patchBuild({ skills: input.build.skills.filter(s => s.id !== skill.id) })}>×</button></span>)}
          <button type="button" className="add-skill" aria-expanded={addingSkill} onClick={() => setAddingSkill(!addingSkill)}>+ Add skill</button></div></div>
        {addingSkill && <div className="skill-search"><label>Search skills<input type="search" value={skillSearch} onChange={event => { setSkillSearch(event.target.value); setSkillId(''); }}/></label>
          <label>Skill<select value={skillId} onChange={event => setSkillId(event.target.value)}><option value="">Choose a skill</option>{availableSkills.map(skill => <option key={skill.id} value={skill.id}>{skill.name} ({skill.id})</option>)}</select></label>
          <button type="button" disabled={!skillId || input.build.skills.length >= 100} onClick={() => { patchBuild({ skills: [...input.build.skills, { id: Number(skillId), level: 1 }] }); setSkillId(''); }}>Add selected skill</button>
          {!!input.build.skills.length && <details><summary>Skill levels and processing order</summary>{input.build.skills.map((skill, i) => <Picker key={skill.id} label={`${i + 1}. ${catalog?.skills.find(s => s.id === skill.id)?.name ?? skill.id}`} value={skill.level} options={['1', '2', '3', '4', '5', '6']} onChange={level => patchBuild({ skills: input.build.skills.map(s => s.id === skill.id ? { ...s, level } : s) })}/>)}</details>}
        </div>}
        <button className="run" type="submit" disabled={!ready || !selectedCourse || !!selectedCourse.unavailable_reason}>Run check</button>
        <small className="run-note">{Math.min(32, seedBudget)} seeds for curve · {seedBudget} near thresholds</small>
      </fieldset>
      {!ready && !error && <p role="status">Loading engine data…</p>}
      {running && <div className="simulation-progress" role="status" aria-live="polite"><progress max={progress?.total ?? 1} value={progress?.completed ?? 0}/><span>{progress ? `${progress.completed} / ${progress.total} races` : 'Preparing simulation…'}</span><button type="button" disabled={cancelling} onClick={() => { void cancel(); }}>{cancelling ? 'Cancelling…' : 'Cancel'}</button></div>}
      {error && <p role="alert">{error}</p>}
    </form>
    <section className="stamina-results" aria-label="Result">
      {result ? <>
        {JSON.stringify({ ...input, request_id: '' }) !== JSON.stringify({ ...result.data.input, request_id: '' }) && <p className="stale-notice" role="status">Inputs changed since this run; press Run check to update</p>}
        <StaminaResults result={result.data} course={result.course}/>
      </> : <div className="panel result-empty"><h2>Check your stamina</h2><p>Choose a race and build to check full spurt and survival rates.</p><p className="muted">90% thresholds are refined to 10 stamina. The curve shows 600–1400. Results are finite-sample estimates.</p></div>}
      <footer>Pacemaker: two runners; order skills use a field of two. Average lobby: nine runners. Simulated with uma-race-simulator (MIT). Game data © Cygames.</footer>
    </section>
  </section>;
}
