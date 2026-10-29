import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { StaminaResults } from './StaminaResults';
import { courseLabel, defaultStaminaInput, type Catalog, type StaminaInput, type StaminaProgress, type StaminaResult } from './staminaTypes';

const styles = ['Front Runner', 'Pace Chaser', 'Late Surger', 'End Closer'];
const grades = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];

function Picker({ label, value, options, onChange }: {
  label: string; value: number; options: string[]; onChange: (value: number) => void;
}) {
  return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(Number(event.target.value))}>
    {options.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
  </select></label>;
}

export function Stamina() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [input, setInput] = useState<StaminaInput>(defaultStaminaInput);
  const [selection, setSelection] = useState('cm:20');
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
          setProgress(previous => ({ ...payload, completed: Math.max(previous?.completed ?? 0, payload.completed) }));
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
  const chooseCourse = (value: string) => {
    setSelection(value);
    const [kind, id] = value.split(':');
    const preset = kind === 'cm' ? catalog?.presets.find(preset => preset.id === Number(id)) : undefined;
    patch(preset ? { course_set_id: preset.course_set_id, ground_condition: preset.ground_condition,
      weather: preset.weather, season: preset.season } : { course_set_id: Number(id) });
  };
  const run = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request_id = crypto.randomUUID();
    const build = { ...input, request_id };
    active.current = request_id;
    setRunning(true); setCancelling(false); setProgress(undefined); setError(''); setResult(undefined);
    try {
      const data = await invoke<StaminaResult>('stamina_check', { input: build });
      if (active.current === request_id) setResult({ data,
        course: courseLabel(catalog!.courses.find(course => course.id === data.input.course_set_id)!) });
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
  const selectedCourse = catalog?.courses.find(course => course.id === input.course_set_id);
  const availableSkills = catalog?.skills.filter(skill =>
    !input.skills.some(selected => selected.id === skill.id) &&
    `${skill.name} ${skill.id}`.toLowerCase().includes(skillSearch.toLowerCase())) ?? [];

  const distanceIndex = !selectedCourse ? 2 : selectedCourse.distance <= 1400 ? 0 : selectedCourse.distance <= 1800 ? 1 : selectedCourse.distance <= 2400 ? 2 : 3;
  const surfaceIndex = selectedCourse?.surface === 2 ? 1 : 0;
  const aptitude = (group: 'distance' | 'style' | 'ground', index: number, label: string) => <Picker label={label} value={input[group][index]!} options={grades} onChange={value => {
    const values = [...input[group]]; values[index] = value; patch({ [group]: values });
  }}/>;
  return <section aria-label="Stamina check" className="stamina-layout">
    <form className="panel stamina-form" aria-label="Build and race" onSubmit={event => { void run(event); }}>
      <fieldset disabled={!ready || running}>
        <label>Race<select aria-label="Course / Champions Meeting preset" value={selection} onChange={event => chooseCourse(event.target.value)}>
          <optgroup label="Champions Meeting presets">{catalog?.presets.map(preset => {
            const course = catalog.courses.find(course => course.id === preset.course_set_id);
            return <option key={preset.id} value={`cm:${preset.id}`}>{preset.name} · {course ? `${course.track_name} ${course.distance} · ${course.surface === 1 ? 'Turf' : 'Dirt'}` : preset.course_set_id}</option>;
          })}</optgroup>
          <optgroup label="All courses">{catalog?.courses.map(course => <option key={course.id} value={`course:${course.id}`} disabled={course.race_instance_id === null}>{courseLabel(course)}{course.race_instance_id === null ? ' · No G1 instance' : ''}</option>)}</optgroup>
        </select></label>
        <small className="muted">{['Good', 'Soft', 'Hard', 'Bad'][input.ground_condition - 1]} · {['Sunny', 'Cloudy', 'Rainy', 'Snow'][input.weather - 1]} · {['Spring', 'Summer', 'Fall', 'Winter', 'Cherry Blossom'][input.season - 1]}</small>
        <div className="field"><span>Strategy</span><div className="seg" role="group" aria-label="Strategy">{['Front', 'Pace', 'Late', 'End'].map((style, i) => <button type="button" key={style} aria-pressed={input.running_style === i + 1} onClick={() => patch({ running_style: i + 1 })}>{style}</button>)}</div></div>
        <div className="raw-stats">{(Object.keys(input.stats) as (keyof StaminaInput['stats'])[]).map(stat => <label key={stat}>{({ speed: 'Spd', stamina: 'Sta', pow: 'Pow', guts: 'Guts', wiz: 'Wit' })[stat]}
          <input className={`num ${stat === 'stamina' ? 'stamina-input' : ''}`} aria-label={stat === 'pow' ? 'Power' : stat === 'wiz' ? 'Wit' : stat[0]!.toUpperCase() + stat.slice(1)} type="number" required min={stat === 'stamina' ? 300 : 1} max={2000} value={input.stats[stat]} onChange={event => patch({ stats: { ...input.stats, [stat]: Number(event.target.value) } })}/></label>)}</div>
        <div className="field"><span>Aptitudes · distance / strategy / surface</span><div className="aptitude-summary">
          {aptitude('distance', distanceIndex, ['Sprint', 'Mile', 'Medium', 'Long'][distanceIndex]!)}
          {aptitude('style', input.running_style - 1, ['Front', 'Pace', 'Late', 'End'][input.running_style - 1]!)}
          {aptitude('ground', surfaceIndex, surfaceIndex ? 'Dirt' : 'Turf')}
          <Picker label="Mood" value={input.motivation} options={['Awful', 'Bad', 'Normal', 'Good', 'Great']} onChange={motivation => patch({ motivation })}/>
        </div></div>
        <details className="edit-all"><summary>Edit all aptitudes and conditions</summary>
          {(['distance', 'style', 'ground'] as const).map(group => <div className="aptitude-grid" key={group}>{({ distance: ['Sprint', 'Mile', 'Medium', 'Long'], style: styles, ground: ['Turf', 'Dirt'] })[group].map((name, i) => <div key={name}>{aptitude(group, i, `${name} aptitude`)}</div>)}</div>)}
          <div className="aptitude-grid"><Picker label="Ground condition" value={input.ground_condition} options={['Good', 'Soft', 'Hard', 'Bad']} onChange={ground_condition => patch({ ground_condition })}/><Picker label="Weather" value={input.weather} options={['Sunny', 'Cloudy', 'Rainy', 'Snow']} onChange={weather => patch({ weather })}/><Picker label="Season" value={input.season} options={['Spring', 'Summer', 'Fall', 'Winter', 'Cherry Blossom']} onChange={season => patch({ season })}/></div>
        </details>
        <div className="field"><span>Recovery skills (your uma only)</span><div className="skill-chips">{input.skills.map(skill => <span className="skill-chip" key={skill.id}><span>{catalog?.skills.find(s => s.id === skill.id)?.name ?? skill.id}</span><button type="button" aria-label={`Remove skill ${skill.id}`} onClick={() => patch({ skills: input.skills.filter(s => s.id !== skill.id) })}>×</button></span>)}
          <button type="button" className="add-skill" aria-expanded={addingSkill} onClick={() => setAddingSkill(!addingSkill)}>+ Add skill</button></div></div>
        {addingSkill && <div className="skill-search"><label>Search skills<input type="search" value={skillSearch} onChange={event => { setSkillSearch(event.target.value); setSkillId(''); }}/></label>
          <label>Skill<select value={skillId} onChange={event => setSkillId(event.target.value)}><option value="">Choose a skill</option>{availableSkills.map(skill => <option key={skill.id} value={skill.id}>{skill.name} ({skill.id})</option>)}</select></label>
          <button type="button" disabled={!skillId || input.skills.length >= 100} onClick={() => { patch({ skills: [...input.skills, { id: Number(skillId), level: 1 }] }); setSkillId(''); }}>Add selected skill</button>
          {!!input.skills.length && <details><summary>Skill levels and processing order</summary>{input.skills.map((skill, i) => <Picker key={skill.id} label={`${i + 1}. ${catalog?.skills.find(s => s.id === skill.id)?.name ?? skill.id}`} value={skill.level} options={['1', '2', '3', '4', '5', '6']} onChange={level => patch({ skills: input.skills.map(s => s.id === skill.id ? { ...s, level } : s) })}/>)}</details>}
        </div>}
        <button className="run" type="submit" disabled={!ready || !selectedCourse?.race_instance_id}>Run check</button>
        <small className="run-note">200 races per stamina value</small>
      </fieldset>
      {!ready && !error && <p role="status">Loading engine data…</p>}
      {running && <div className="simulation-progress" role="status" aria-live="polite"><progress max={progress?.total ?? 1} value={progress?.completed ?? 0}/><span>{progress ? `${progress.completed} / ${progress.total} races` : 'Preparing simulation…'}</span><button type="button" disabled={cancelling} onClick={() => { void cancel(); }}>{cancelling ? 'Cancelling…' : 'Cancel'}</button></div>}
      {error && <p role="alert">{error}</p>}
    </form>
    <section className="stamina-results" aria-label="Result">
      {result ? <>
        {JSON.stringify({ ...input, request_id: '' }) !== JSON.stringify({ ...result.data.input, request_id: '' }) && <p className="stale-notice" role="status">Inputs changed since this run; press Run check to update</p>}
        <StaminaResults result={result.data} course={result.course}/>
      </> : <div className="panel result-empty"><h2>Check your stamina</h2><p>Choose a race and build, then run a check to see your chance of finishing without running out of HP.</p><p className="muted">The 95% threshold is the smallest tested value, in steps of 50 from 300 to 2000. Results are finite-sample estimates.</p></div>}
      <footer>Field: 8 copies of your build without skills. Simulated with uma-race-simulator (MIT). Game data © Cygames.</footer>
    </section>
  </section>;
}
