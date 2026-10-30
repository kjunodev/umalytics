import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { StaminaResults } from './StaminaResults';
import { SkillPicker } from './SkillPicker';
import { loadStaminaMemory, saveStaminaMemory } from './staminaState';
import { courseLabel, defaultStaminaInput, groundNames, weatherNames, seasonNames, type Catalog, type StaminaBuild, type StaminaInput, type StaminaProgress, type StaminaResult } from './staminaTypes';

const styles = ['Front', 'Pace', 'Late', 'End'];
const moods = ['Awful', 'Bad', 'Normal', 'Good', 'Great'];
const grades = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
const toggles = [['assume_skills_activate', 'Assume skills activate'], ['rushed', 'Rushed'], ['spot_struggle', 'Spot Struggle'], ['dueling', 'Dueling'], ['lane_movement', 'Lane movement']] as const;
type Popover = 'race' | 'ground' | 'weather' | 'season' | 'advanced';
let missingDataNoticeShown = false;

function Picker({ label, value, options, onChange }: { label: string; value: number; options: string[]; onChange: (value: number) => void }) {
  return <label>{label}<select aria-label={label} value={value} onChange={e => onChange(Number(e.target.value))}>{options.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>;
}
function Segments({ label, value, options, onChange }: { label: string; value: number; options: string[]; onChange: (value: number) => void }) {
  return <div className="field"><span>{label}</span><div className="seg" role="group" aria-label={label}>{options.map((name, i) => <button type="button" key={name} aria-pressed={value === i + 1} onClick={() => onChange(i + 1)}>{name}</button>)}</div></div>;
}

export function Stamina() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [input, setInput] = useState<StaminaInput>(defaultStaminaInput);
  const [recent, setRecent] = useState<number[]>([]), [showAll, setShowAll] = useState(false);
  const [popover, setPopover] = useState<Popover>(), [buildOpen, setBuildOpen] = useState(false);
  const [notice, setNotice] = useState(false), [error, setError] = useState(''), [saveError, setSaveError] = useState('');
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<StaminaProgress>();
  const [result, setResult] = useState<{ data: StaminaResult; course: string }>();
  const active = useRef<string | null>(null), toolbar = useRef<HTMLDivElement>(null), buildButton = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const popupTrigger = useRef<HTMLButtonElement | null>(null), drawer = useRef<HTMLElement>(null);

  useEffect(() => {
    let disposed = false, stop: UnlistenFn | undefined;
    void (async () => {
      stop = await listen<StaminaProgress>('stamina-progress', ({ payload }) => {
        if (payload.request_id === active.current) setProgress(previous => payload.percent >= (previous?.percent ?? 0) ? payload : previous);
      });
      if (disposed) { stop(); return; }
      const data = await invoke<Catalog>('engine_catalog');
      let memory;
      try { memory = await loadStaminaMemory(data); }
      catch { if (!disposed) setSaveError('Remembered inputs could not be loaded. Using defaults.'); }
      if (!disposed) {
        setCatalog(data);
        if (memory) { setInput(memory.input); setRecent(memory.recent); setShowAll(memory.showAll); }
        if (!data.local_skill_data && !missingDataNoticeShown) { missingDataNoticeShown = true; setNotice(true); }
        setReady(true);
      }
    })().catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; stop?.(); if (active.current) void invoke('cancel_stamina_check').catch(() => {}); active.current = null; };
  }, []);

  useEffect(() => {
    if (ready) void saveStaminaMemory({ input, recent, showAll }).then(() => setSaveError('')).catch(() => setSaveError('Inputs could not be saved. Your current build is still available.'));
  }, [ready, input, recent, showAll]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (popover) { setPopover(undefined); popupTrigger.current?.focus(); }
      else if (buildOpen) { setBuildOpen(false); buildButton.current?.focus(); }
    };
    const outside = (e: PointerEvent) => { if (popover && !toolbar.current?.contains(e.target as Node)) setPopover(undefined); };
    document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); };
  }, [popover, buildOpen]);
  useEffect(() => { if (buildOpen) closeButton.current?.focus(); }, [buildOpen]);
  useEffect(() => { if (popover) toolbar.current?.querySelector<HTMLElement>('.stamina-popover button, .stamina-popover select')?.focus(); }, [popover]);

  const patch = (next: Partial<StaminaInput>) => setInput(previous => ({ ...previous, ...next }));
  const patchBuild = (next: Partial<StaminaBuild>) => setInput(previous => ({ ...previous, build: { ...previous.build, ...next } }));
  const patchRace = (next: Partial<StaminaInput['race']>) => setInput(previous => ({ ...previous, race: { ...previous.race, ...next } }));
  const run = async () => {
    if (!drawer.current?.querySelectorAll('input:invalid').length && ready) {
      const request_id = crypto.randomUUID(), submitted = { ...input, request_id };
      active.current = request_id;
      setRunning(true); setCancelling(false); setProgress(undefined); setError(''); setPopover(undefined); setBuildOpen(false);
      try {
        const data = await invoke<StaminaResult>('stamina_check', { input: submitted });
        if (active.current === request_id) { setResult({ data, course: courseLabel(data.course) }); setProgress({ request_id, map_id: data.input.race.map_id, completed: data.races, total: data.races, stage: 'done', percent: 100 }); }
      } catch (reason) { if (active.current === request_id) setError(String(reason)); }
      finally { if (active.current === request_id) { active.current = null; setRunning(false); setCancelling(false); } }
    } else drawer.current?.querySelector<HTMLInputElement>('input:invalid')?.reportValidity();
  };
  const cancel = async () => { setCancelling(true); try { await invoke('cancel_stamina_check'); } catch (reason) { setError(String(reason)); setCancelling(false); } };
  const selectedCourse = catalog?.courses.find(c => c.id === input.race.map_id);
  const compactRace = selectedCourse ? `${selectedCourse.track_name} ${selectedCourse.distance} · ${selectedCourse.surface === 1 ? 'Turf' : 'Dirt'}${selectedCourse.variant ? ` · ${selectedCourse.variant}` : ''}` : 'Choose race';
  const toggle = (name: Popover, target: HTMLButtonElement) => { popupTrigger.current = target; setPopover(popover === name ? undefined : name); };
  const trigger = (name: Popover, label: string, content: ReactNode) => <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={popover === name} aria-controls={popover === name ? 'stamina-popover' : undefined} disabled={!ready || running} onClick={e => toggle(name, e.currentTarget)}>{content}</button>;
  const aptitude = (group: 'distance' | 'style' | 'ground', i: number, label: string) => <Picker key={label} label={label} value={input.build[group][i]!} options={grades} onChange={value => { const values = [...input.build[group]]; values[i] = value; patchBuild({ [group]: values }); }}/>;
  const stageLabel = progress?.stage === 'done' ? 'Done' : progress?.stage === 'refining' ? 'Refining thresholds' : 'Mapping the curve';
  return <section aria-label="Stamina check" className="stamina-layout">
    <div className="stamina-toolbar panel" ref={toolbar}>
      <div className="toolbar-race">{trigger('race', 'Race', compactRace)}</div>
      <div className="condition-chips">{trigger('ground', 'Ground condition', groundNames[input.race.ground_condition - 1])}{trigger('weather', 'Weather', weatherNames[input.race.weather - 1])}{trigger('season', 'Season', seasonNames[input.race.season - 1])}</div>
      <button ref={buildButton} className="toolbar-build" type="button" aria-label="Build" aria-expanded={buildOpen} disabled={!ready || running} onClick={() => { setBuildOpen(true); setPopover(undefined); }}><span className="label">Build</span><span>{styles[input.build.running_style - 1]} · {Object.values(input.build.stats).join('/')} · {input.build.skills.length} {input.build.skills.length === 1 ? 'skill' : 'skills'}</span></button>
      <button className="run" type="button" disabled={!ready || running || !selectedCourse || !!selectedCourse.unavailable_reason} onClick={() => { void run(); }}>{running ? 'Running…' : 'Run check'}</button>
      {trigger('advanced', 'Advanced settings', <span aria-hidden="true">⚙</span>)}
      {popover && <div className={`stamina-popover panel popover-${popover}`} role="dialog" aria-label={popover === 'race' ? 'Choose race' : popover === 'advanced' ? 'Advanced settings' : `Choose ${popover}`} id="stamina-popover">
        <div className="popover-heading"><h2>{popover === 'race' ? 'Race' : popover === 'advanced' ? 'Advanced settings' : `Choose ${popover}`}</h2><button type="button" aria-label="Close picker" onClick={() => { setPopover(undefined); popupTrigger.current?.focus(); }}>×</button></div>
        {popover === 'race' ? <>
          <div className="field"><span>Track</span><div className="course-chips" role="group" aria-label="Track">{[...new Set(catalog?.courses.map(c => c.track_name))].map(track => <button type="button" key={track} aria-pressed={selectedCourse?.track_name === track} onClick={() => patchRace({ map_id: catalog!.courses.find(c => c.track_name === track)!.id })}>{track}</button>)}</div></div>
          <div className="field"><span>Distance · surface · variant</span><div className="course-chips" role="group" aria-label="Race">{catalog?.courses.filter(c => c.track_name === selectedCourse?.track_name).map(c => <button type="button" key={c.id} title={c.unavailable_reason ?? undefined} aria-pressed={c.id === input.race.map_id} onClick={() => { patchRace({ map_id: c.id }); setPopover(undefined); popupTrigger.current?.focus(); }}>{c.distance} · {c.surface === 1 ? 'Turf' : 'Dirt'}{c.variant ? ` · ${c.variant}` : ''}{c.unavailable_reason ? ' · Unavailable' : ''}</button>)}</div></div>
        </> : popover === 'advanced' ? <>
          <div className="field"><span>Field</span><div className="seg field-options" role="group" aria-label="Field">{(['average_lobby', 'mirror', 'pacemaker'] as const).map(field => <button type="button" key={field} aria-pressed={input.field === field} onClick={() => patch({ field })}>{field === 'average_lobby' ? 'Average lobby' : field === 'mirror' ? 'Mirror' : '2-runner (skill position conditions see 2 runners)'}</button>)}</div><small className="muted">{input.field === 'mirror' ? '8 opponents with your submitted stats · A aptitudes · Great · no skills · 2 Front / 3 Pace / 2 Late / 1 End.' : input.field === 'average_lobby' ? '8 opponents · 1600/1200/1200/600/1200 · A aptitudes · Great · no skills.' : 'One Front runner; position conditions see 2 runners.'}</small></div>
          {toggles.map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={input[key]} onChange={e => patch({ [key]: e.target.checked })}/></label>)}
          <small className="muted">Assume skills activate passes Wit checks. Timing and position conditions still apply.</small>
          <Picker label="Mood" value={input.build.motivation} options={moods} onChange={motivation => patchBuild({ motivation })}/>
        </> : <Segments label={popover === 'ground' ? 'Ground' : popover === 'weather' ? 'Weather' : 'Season'} value={popover === 'ground' ? input.race.ground_condition : popover === 'weather' ? input.race.weather : input.race.season} options={popover === 'ground' ? groundNames : popover === 'weather' ? weatherNames : seasonNames} onChange={value => { patchRace({ [popover === 'ground' ? 'ground_condition' : popover]: value }); setPopover(undefined); popupTrigger.current?.focus(); }}/>}</div>}
    </div>
    {!ready && !error && <p role="status">Loading engine data…</p>}
    {selectedCourse?.unavailable_reason && <p role="status">{selectedCourse.unavailable_reason}</p>}
    {(running || progress?.stage === 'done') && <div className="simulation-progress" role="status" aria-live="polite"><span>{stageLabel}</span><progress aria-label="Simulation progress" aria-valuetext={stageLabel} max={100} value={progress?.percent ?? 0}/>{running && <button type="button" disabled={cancelling} onClick={() => { void cancel(); }}>{cancelling ? 'Cancelling…' : 'Cancel'}</button>}</div>}
    {error && <p role="alert">{error}</p>}{saveError && <p role="status" className="muted">{saveError}</p>}
    <section className="stamina-results" aria-label="Result">
      {result ? <>{JSON.stringify({ ...input, request_id: '' }) !== JSON.stringify({ ...result.data.input, request_id: '' }) && <p className="stale-notice" role="status">Inputs changed since this run; press Run check to update</p>}<StaminaResults result={result.data} course={result.course} skills={catalog?.skills ?? []}/></> : <div className="panel result-empty"><h2>How much stamina do you need?</h2><p>Choose a race and build, then run a check. Your answer measures full spurt and survival together in at least 90% of races.</p><p className="muted">Thresholds are refined to 10 stamina. Estimates use finite samples.</p></div>}
      <footer>Simulated with uma-race-simulator (MIT). Game data © Cygames.</footer>
    </section>
    {buildOpen && catalog && createPortal(<aside ref={drawer} className="build-drawer desktop-tool panel" role="dialog" aria-label="Build editor">
      <div className="drawer-heading"><div><span className="label">Your uma</span><h2>Build editor</h2></div><button ref={closeButton} type="button" aria-label="Close build editor" onClick={() => { setBuildOpen(false); buildButton.current?.focus(); }}>×</button></div>
      <div className="build-body">
        <Segments label="Strategy" value={input.build.running_style} options={styles} onChange={running_style => patchBuild({ running_style })}/>
        <div className="raw-stats">{(['speed', 'stamina', 'pow', 'guts', 'wiz'] as const).map(stat => <label key={stat}>{({ speed: 'Speed', stamina: 'Stamina', pow: 'Power', guts: 'Guts', wiz: 'Wit' })[stat]}<input className={`num ${stat === 'stamina' ? 'stamina-input' : ''}`} aria-label={stat === 'pow' ? 'Power' : stat === 'wiz' ? 'Wit' : stat[0]!.toUpperCase() + stat.slice(1)} type="number" required min={1} max={2000} value={input.build.stats[stat]} onChange={e => patchBuild({ stats: { ...input.build.stats, [stat]: Number(e.target.value) } })}/></label>)}</div>
        <Picker label="Mood" value={input.build.motivation} options={moods} onChange={motivation => patchBuild({ motivation })}/>
        <div className="field"><span>Aptitudes</span>{(['distance', 'style', 'ground'] as const).map(group => <div className={`aptitude-grid aptitude-${group}`} key={group}>{({ distance: ['Sprint', 'Mile', 'Medium', 'Long'], style: styles, ground: ['Turf', 'Dirt'] })[group].map((name, i) => aptitude(group, i, `${name} aptitude`))}</div>)}</div>
        <div className="field"><span>Skills · your uma only</span>{notice && <small className="muted" role="status">Local skill data unavailable. Using engine names without icons.</small>}<SkillPicker catalog={catalog} skills={input.build.skills} onChange={skills => patchBuild({ skills })} recent={recent} onRecent={setRecent} showAll={showAll} onShowAll={setShowAll}/></div>
      </div>
      <div className="drawer-footer"><span className="muted">Inputs remembered automatically</span><button type="button" onClick={() => { setBuildOpen(false); buildButton.current?.focus(); }}>Done</button></div>
    </aside>, document.body)}
  </section>;
}
