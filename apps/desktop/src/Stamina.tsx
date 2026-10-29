import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<StaminaProgress>();
  const [result, setResult] = useState<{ data: StaminaResult; build: StaminaInput; course: string }>();
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
      if (active.current === request_id) setResult({ data, build,
        course: courseLabel(catalog!.courses.find(course => course.id === build.course_set_id)!) });
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

  return <section aria-label="Stamina check" className="stamina">
    <h2>Stamina check</h2>
    <p>Estimate the chance of finishing without an HP-out against eight copies of your current build.
      The threshold is the smallest tested stamina reaching 95%, in steps of 50 from 300 to 1600.</p>
    <p>Simulated with uma-race-simulator (MIT)</p>
    {!ready && !error && <p role="status">Loading engine data…</p>}
    <form onSubmit={event => { void run(event); }}>
      <fieldset disabled={!ready || running}>
        <legend>Course and conditions</legend>
        <label>Course / Champions Meeting preset<select aria-label="Course / Champions Meeting preset" value={selection} onChange={event => chooseCourse(event.target.value)}>
          <optgroup label="Champions Meeting presets">{catalog?.presets.map(preset => {
            const course = catalog.courses.find(course => course.id === preset.course_set_id);
            return <option key={preset.id} value={`cm:${preset.id}`}>{preset.name} #{preset.id}{preset.date ? ` · ${preset.date}` : ''} · {course ? courseLabel(course) : preset.course_set_id}</option>;
          })}</optgroup>
          <optgroup label="All courses">{catalog?.courses.map(course => <option key={course.id} value={`course:${course.id}`}
            disabled={course.race_instance_id === null}>{courseLabel(course)}{course.race_instance_id === null ? ' · No G1 instance' : ''}</option>)}</optgroup>
        </select></label>
        <div className="stamina-grid">
          <Picker label="Ground condition" value={input.ground_condition} options={['Good', 'Soft', 'Hard', 'Bad']} onChange={ground_condition => patch({ ground_condition })} />
          <Picker label="Weather" value={input.weather} options={['Sunny', 'Cloudy', 'Rainy', 'Snow']} onChange={weather => patch({ weather })} />
          <Picker label="Season" value={input.season} options={['Spring', 'Summer', 'Fall', 'Winter', 'Cherry Blossom']} onChange={season => patch({ season })} />
          <Picker label="Strategy" value={input.running_style} options={styles} onChange={running_style => patch({ running_style })} />
          <Picker label="Mood" value={input.motivation} options={['Awful', 'Bad', 'Normal', 'Good', 'Great']} onChange={motivation => patch({ motivation })} />
        </div>
        <p>Champions rules · Daytime · Race instance {selectedCourse?.race_instance_id ?? '—'}</p>
      </fieldset>
      <fieldset disabled={!ready || running}>
        <legend>Raw stats and aptitudes</legend>
        <div className="stamina-grid">{(Object.keys(input.stats) as (keyof StaminaInput['stats'])[]).map(stat =>
          <label key={stat}>{({ speed: 'Speed', stamina: 'Stamina', pow: 'Power', guts: 'Guts', wiz: 'Wit' })[stat]}
            <input type="number" required min={stat === 'stamina' ? 300 : 1} max={stat === 'stamina' ? 1600 : 2000}
              value={input.stats[stat]} onChange={event => patch({ stats: { ...input.stats, [stat]: Number(event.target.value) } })} />
          </label>)}</div>
        {(['distance', 'style', 'ground'] as const).map(group => <div className="aptitudes" key={group}>
          <h3>{({ distance: 'Distance aptitude', style: 'Strategy aptitude', ground: 'Surface aptitude' })[group]}</h3>
          <div className="stamina-grid">{({ distance: ['Sprint', 'Mile', 'Medium', 'Long'], style: styles, ground: ['Turf', 'Dirt'] })[group].map((label, index) =>
            <Picker key={label} label={`${label} aptitude`} options={grades} value={input[group][index]!} onChange={value => {
              const values = [...input[group]]; values[index] = value;
              patch({ [group]: values });
            }} />)}</div>
        </div>)}
      </fieldset>
      <fieldset disabled={!ready || running}>
        <legend>Optional skills (processing order)</legend>
        <label>Search skills<input type="search" value={skillSearch} onChange={event => { setSkillSearch(event.target.value); setSkillId(''); }} /></label>
        <div className="skill-add"><label>Skill<select aria-label="Skill" value={skillId} onChange={event => setSkillId(event.target.value)}>
          <option value="">Choose a skill</option>
          {availableSkills.map(skill => <option key={skill.id} value={skill.id}>{skill.name} ({skill.id})</option>)}
        </select></label>
        <button type="button" disabled={!skillId || input.skills.length >= 100} onClick={() => {
          patch({ skills: [...input.skills, { id: Number(skillId), level: 1 }] }); setSkillId('');
        }}>Add skill</button></div>
        {input.skills.map((skill, index) => <div className="selected-skill" key={skill.id}>
          <span>{index + 1}. {catalog?.skills.find(s => s.id === skill.id)?.name} ({skill.id})</span>
          <Picker label={`Level for skill ${skill.id}`} value={skill.level} options={['1', '2', '3', '4', '5', '6']}
            onChange={level => patch({ skills: input.skills.map(s => s.id === skill.id ? { ...s, level } : s) })} />
          <button type="button" onClick={() => patch({ skills: input.skills.filter(s => s.id !== skill.id) })}>Remove skill {skill.id}</button>
        </div>)}
        <p>Skills are applied to all nine runners. Add them in the intended processing order; levels range from 1 to 6.</p>
      </fieldset>
      <div className="stamina-actions">
        <label>Seeds per stamina<input type="number" min="1" max="1000" required value={input.seeds} disabled={running}
          onChange={event => patch({ seeds: Number(event.target.value) })} /></label>
        <button type="submit" disabled={!ready || running || !selectedCourse?.race_instance_id}>Run</button>
        {running && <button type="button" disabled={cancelling} onClick={() => { void cancel(); }}>{cancelling ? 'Cancelling…' : 'Cancel'}</button>}
      </div>
    </form>
    {running && <div role="status" aria-live="polite">
      <progress max={progress?.total ?? 1} value={progress?.completed ?? 0} />
      <span> {progress ? `${progress.completed} / ${progress.total} races` : 'Preparing simulation…'}</span>
    </div>}
    {error && <p role="alert">{error}</p>}
    {result && <div aria-live="polite">
      <h3>Results · {result.course}</h3>
      <p>Build: Speed {result.build.stats.speed}, Stamina {result.build.stats.stamina}, Power {result.build.stats.pow},
        Guts {result.build.stats.guts}, Wit {result.build.stats.wiz} · {styles[result.build.running_style - 1]}</p>
      <p>Current stamina {result.data.current.stamina}: <strong>{result.data.current.no_hp_out_percent.toFixed(1)}% no HP-out</strong></p>
      <p>95% threshold: <strong>{result.data.threshold ?? 'Not reached (300–1600)'}</strong> · smallest tested value; finite-seed estimate.</p>
      <p>{result.data.races.toLocaleString()} races · {result.data.seeds} seeds per stamina · {(result.data.elapsed_ms / 1000).toFixed(2)} s total · {result.data.ms_per_race.toFixed(2)} ms/race (wall time across cores)</p>
      <div className="stamina-table"><table>
        <caption>No HP-out through the goal-crossing engine tick</caption>
        <thead><tr><th>Stamina</th><th>% no HP-out</th><th>Avg minimum HP</th></tr></thead>
        <tbody>{result.data.curve.map(point => <tr key={point.stamina} className={point.stamina === result.data.threshold ? 'threshold' : ''}>
          <th scope="row">{point.stamina}{point.stamina === result.data.current.stamina ? ' (current)' : ''}{point.stamina === result.data.threshold ? ' (95% threshold)' : ''}</th>
          <td>{point.no_hp_out_percent.toFixed(1)}%</td><td>{point.avg_min_hp.toFixed(2)}</td>
        </tr>)}</tbody>
      </table></div>
    </div>}
  </section>;
}
