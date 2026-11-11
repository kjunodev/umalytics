import { NumberField } from './NumberField';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DraftSnapshot } from '@umalytics/shared';
import { StaminaPresets } from './StaminaPresets';
import { loadPresets, savePresets, restorePresets, type PresetMemory } from './staminaPresetState';
import { draftRaces, draftFingerprint, unknownCourseDiagnostics, passes, type DraftRace, type CourseChoices } from './staminaDraft';
import { StaminaResults } from './StaminaResults';
import { StaminaUmaPicker } from './StaminaUmaPicker';
import { SkillPicker } from './SkillPicker';
import { loadStaminaMemory, saveStaminaMemory, selectUma, type BuildTab } from './staminaState';
import { RaceSettings } from './RaceSettings';
import { courseLabel, defaultStaminaInput, groundNames, weatherNames, seasonNames, staminaEngineInput, type Catalog, type StaminaEditorBuild, type StaminaEditorInput, type StaminaInput, type StaminaProgress, type StaminaResult, type StaminaRaceResult, roleNames, strategy, withStrategy } from './staminaTypes';
import { getVersion } from '@tauri-apps/api/app';
import { canonicalJson } from './canonicalJson.mjs';

export interface DraftRun { matchCode?: string; fingerprint: string; input: StaminaInput; slots: DraftRace[]; results: (StaminaResult | undefined)[] }

const styles = roleNames.slice(0, 4);
const grades = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
type Popover = 'draft-course' | 'race' | 'ground' | 'weather' | 'season';
let missingDataNoticeShown = false;

function Picker({ label, value, options, onChange }: { label: string; value: number; options: string[]; onChange: (value: number) => void }) {
  return <label>{label.replace(" aptitude", "")}<select aria-label={label} value={value} onChange={e => onChange(Number(e.target.value))}>{options.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>;
}
function Segments({ label, value, options, onChange }: { label: string; value: number; options: string[]; onChange: (value: number) => void }) {
  return <div className="field"><span>{label}</span><div className="seg" role="group" aria-label={label}>{options.map((name, i) => <button type="button" key={name} aria-pressed={value === i + 1} onClick={() => onChange(i + 1)}>{name}</button>)}</div></div>;
}

export function Stamina({ draft, openDraft = 0, onDraftRunChange, onDataError }: { draft?: DraftSnapshot; openDraft?: number; onDraftRunChange?: (run: DraftRun | undefined) => void; onDataError: (failed: boolean) => void }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [anyInput, setAnyInput] = useState<StaminaEditorInput>(defaultStaminaInput);
  const [draftInput, setDraftInput] = useState<StaminaEditorInput>(structuredClone(defaultStaminaInput));
  const [mode, setMode] = useState<'draft' | 'any'>('any');
  const input = mode === 'draft' ? draftInput : anyInput, setInput = mode === 'draft' ? setDraftInput : setAnyInput;
  const [buildTab, setBuildTab] = useState<BuildTab>('build');
  const [buildCustomized, setBuildCustomized] = useState(false);
  const [presets, setPresets] = useState<PresetMemory>();
  const [presetError, setPresetError] = useState('');
  const [presetWritable, setPresetWritable] = useState(false);
  const [storedDraftRun, setDraftRun] = useState<DraftRun>();
  const draftRun = storedDraftRun?.matchCode === draft?.matchCode ? storedDraftRun : undefined;
  const [detail, setDetail] = useState<number>();
  const batchSlots = useRef<number[] | null>(null);
  const [courseChoices, setCourseChoices] = useState<CourseChoices>({});
  const [courseChoice, setCourseChoice] = useState<{ code: string; key: string; raw: string }>();
  const [courseQuery, setCourseQuery] = useState('');
  const [recent, setRecent] = useState<number[]>([]);
  const [popover, setPopover] = useState<Popover>(), [buildCollapsed, setBuildCollapsed] = useState(false);
  const [notice, setNotice] = useState(false), [error, setError] = useState(''), [saveError, setSaveError] = useState('');
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<StaminaProgress>();
  const [result, setResult] = useState<{ data: StaminaResult; course: string }>();
  const active = useRef<string | null>(null), toolbar = useRef<HTMLDivElement>(null), expandButton = useRef<HTMLButtonElement>(null), collapseButton = useRef<HTMLButtonElement>(null);
  const popupTrigger = useRef<HTMLButtonElement | null>(null), drawer = useRef<HTMLElement>(null);
  const focusBuildToggle = useRef(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [dataError, setDataError] = useState<{ details: string }>();
  const [dataCopyStatus, setDataCopyStatus] = useState('');
  useEffect(() => { onDraftRunChange?.(draftRun); }, [draftRun, onDraftRunChange]);
  useEffect(() => { if (openDraft) { setMode('draft'); setDetail(undefined); setPopover(undefined); } }, [openDraft]);

  useEffect(() => {
    let disposed = false; const stops: UnlistenFn[] = [];
    void (async () => {
      const stop = await listen<StaminaProgress>('stamina-progress', ({ payload }) => {
        if (payload.request_id === active.current) setProgress(previous => payload.percent >= (previous?.percent ?? 0) ? payload : previous);
      });
      if (disposed) { stop(); return; } stops.push(stop);
      const stopResult = await listen<StaminaRaceResult>('stamina-race-result', ({ payload }) => {
        if (payload.request_id !== active.current || !batchSlots.current) return;
        const index = batchSlots.current[payload.index];
        if (index !== undefined) setDraftRun(previous => { if (!previous) return previous; const results = [...previous.results]; results[index] = payload.result; return { ...previous, results }; });
      });
      if (disposed) { stopResult(); return; } stops.push(stopResult);
      let data: Catalog;
      try { data = await invoke<Catalog>('engine_catalog'); }
      catch (reason) {
        if (!disposed) { setDataError({ details: String(reason) }); onDataError(true); }
        return;
      }
      let memory;
      try { memory = await loadStaminaMemory(data); }
      catch { if (!disposed) setSaveError('Remembered inputs could not be loaded. Using defaults.'); }
      if (!disposed) {
        setCatalog(data);
        if (memory) { setAnyInput(memory.input); setDraftInput(memory.draftInput ?? structuredClone(memory.input)); setRecent(memory.recent); setBuildCollapsed(memory.buildCollapsed); setBuildTab(memory.buildTab ?? 'build'); setBuildCustomized(memory.buildCustomized ?? false); setCourseChoices(memory.courseChoices ?? {}); }
        if (!data.local_skill_data && !missingDataNoticeShown) { missingDataNoticeShown = true; setNotice(true); }
        setReady(true);
      }
      try { const saved = await loadPresets(data); if (!disposed) { setPresets(saved); setPresetWritable(true); } }
      catch { if (!disposed) { setPresets(restorePresets(undefined, data)); setPresetError('Presets could not be loaded. Changes will not be saved until reload.'); } }
    })().catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; stops.forEach(stop => stop()); if (active.current) void invoke('cancel_stamina_check').catch(() => {}); active.current = null; };
  }, []);

  useEffect(() => {
    if (ready) void saveStaminaMemory({ input: anyInput, draftInput, recent, buildCollapsed, buildTab, buildCustomized, courseChoices }).then(() => setSaveError('')).catch(() => setSaveError('Inputs could not be saved. Your current build is still available.'));
  }, [ready, anyInput, draftInput, recent, buildCollapsed, buildTab, buildCustomized, courseChoices]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (popover) { setPopover(undefined); popupTrigger.current?.focus(); }
    };
    const outside = (e: PointerEvent) => { if (popover && !toolbar.current?.contains(e.target as Node)) setPopover(undefined); };
    document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); };
  }, [popover]);
  useEffect(() => { if (focusBuildToggle.current) { (buildCollapsed ? expandButton : collapseButton).current?.focus(); focusBuildToggle.current = false; } }, [buildCollapsed]);
  useEffect(() => { if (popover) toolbar.current?.querySelector<HTMLElement>(popover === 'draft-course' ? '.draft-course-query' : '.stamina-popover button, .stamina-popover select')?.focus(); }, [popover]);
  useEffect(() => { setPopover(current => current === 'draft-course' ? undefined : current); }, [draft?.matchCode]);

  const patch = (next: Partial<StaminaInput>) => setInput(previous => ({ ...previous, ...next }));
  const patchBuild = (next: Partial<StaminaEditorBuild>) => { setBuildCustomized(true); setInput(previous => ({ ...previous, build: { ...previous.build, ...next } })); };
  const toggleBuild = (collapsed: boolean) => { focusBuildToggle.current = true; setBuildCollapsed(collapsed); };
  const openBuild = (tab: BuildTab) => { if (buildCollapsed) toggleBuild(false); setBuildTab(tab); setPopover(undefined); };
  const copyCourseDiagnostics = async (slot: DraftRace, raceNumber: number) => {
    try { const version = await getVersion(); await navigator.clipboard.writeText(unknownCourseDiagnostics(draft?.matchCode, raceNumber, slot, version, catalog?.engine_data_version)); setCopyStatus('Diagnostics copied'); }
    catch { setCopyStatus('Unable to copy diagnostics.'); }
  };
  const patchRace = (next: Partial<StaminaInput['race']>) => setInput(previous => ({ ...previous, race: { ...previous.race, ...next } }));
  const races = catalog ? draftRaces(draft, catalog, courseChoices) : [];
  const fingerprint = draftFingerprint(draft, races);
  const run = async () => {
    if (!drawer.current?.querySelectorAll('input:invalid').length && ready) {
      const request_id = crypto.randomUUID(), submitted = staminaEngineInput({ ...input, request_id });
      active.current = request_id;
      batchSlots.current = mode === 'draft' ? races.flatMap((race, i) => race.race ? [i] : []) : null;
      if (mode === 'draft') { setDraftRun({ matchCode: draft?.matchCode, fingerprint, input: structuredClone(submitted), slots: structuredClone(races), results: [] }); setDetail(undefined); }
      setRunning(true); setCancelling(false); setProgress(undefined); setError(''); setPopover(undefined);
      try {
        if (mode === 'draft') {
          const { race: _race, ...batch } = submitted;
          const slots = batchSlots.current!;
          const data = await invoke<StaminaResult[]>('stamina_check_races', { input: { ...batch, races: slots.map(i => races[i]!.race!) } });
          if (active.current === request_id) setDraftRun(previous => { if (!previous) return previous; const results = [...previous.results]; data.forEach((item, i) => { results[slots[i]!] = item; }); return { ...previous, results }; });
        } else {
          const data = await invoke<StaminaResult>('stamina_check', { input: submitted });
          if (active.current === request_id) { setResult({ data, course: courseLabel(data.course) }); setProgress({ request_id, map_id: data.input.race.map_id, completed: data.races, total: data.races, stage: 'done', percent: 100 }); }
        }
      } catch (reason) { if (active.current === request_id) setError(String(reason)); }
      finally { if (active.current === request_id) { active.current = null; setRunning(false); setCancelling(false); } }
    } else drawer.current?.querySelector<HTMLInputElement>('input:invalid')?.reportValidity();
  };
  const cancel = async () => { setCancelling(true); try { await invoke('cancel_stamina_check'); } catch (reason) { setError(String(reason)); setCancelling(false); } };
  const selectedCourse = catalog?.courses.find(c => c.id === input.race.map_id);
  const selectedUma = catalog?.umas.find(uma => uma.card_id === input.build.umaCardId);
  const uniques = input.build.skills.flatMap(skill => {
    const meta = catalog?.skills.find(candidate => candidate.id === skill.id);
    return meta?.rarity === 'unique' || (meta && skill.id === selectedUma?.unique_skill_id) ? [{ skill, meta }] : [];
  });
  const ordinary = input.build.skills.filter(skill => !uniques.some(unique => unique.skill.id === skill.id));
  const engineInput = staminaEngineInput({ ...input, request_id: '' });
  const compactRace = selectedCourse ? `${selectedCourse.track_name} ${selectedCourse.distance} · ${selectedCourse.surface === 1 ? 'Turf' : 'Dirt'}${selectedCourse.variant ? ` · ${selectedCourse.variant}` : ''}` : 'Choose race';
  const toggle = (name: Popover, target: HTMLButtonElement) => { popupTrigger.current = target; setPopover(popover === name ? undefined : name); };
  const trigger = (name: Popover, label: string, content: ReactNode) => <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={popover === name} aria-controls={popover === name ? 'stamina-popover' : undefined} disabled={!ready || running} onClick={e => toggle(name, e.currentTarget)}>{content}</button>;
  const aptitude = (group: 'distance' | 'style' | 'ground', i: number, label: string) => <Picker key={label} label={label} value={input.build[group][i]!} options={grades} onChange={value => { const values = [...input.build[group]]; values[i] = value; patchBuild({ [group]: values }); }}/>;
  const stageLabel = progress?.stage === 'done' ? (progress.percent === 100 ? 'Done' : 'Race finished') : progress?.stage === 'refining' ? 'Refining thresholds' : 'Mapping the curve';
  const shownRaces = draftRun?.slots.map((slot, i) => !draftRun.results[i] && races[i]?.raw === slot.raw ? races[i]! : slot) ?? races;
  const finished = (draftRun?.results ?? []).filter((r): r is StaminaResult => !!r);
  const maxNeed = finished.length ? Math.max(...finished.map(r => r.needed_effective_stamina.joint ?? Infinity)) : 0;
  const available = finished.map(r => Math.round(r.effective_stamina));
  const short = finished.filter(r => !passes(r)).length;
  const changePresets = (next: PresetMemory) => { setPresets(next); if (presetWritable) void savePresets(next).then(() => setPresetError('')).catch(() => setPresetError('Presets could not be saved. Your edits are still available until reload.')); };
  if (dataError) return <section className="panel stamina-data-error" role="alert">
    <h2>UmaLytics could not load its race data.</h2>
    <p>Reinstall UmaLytics from the latest release.</p>
    <pre>{dataError.details}</pre>
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(dataError.details); setDataCopyStatus('Details copied'); }
      catch { setDataCopyStatus('Unable to copy details.'); }
    }}>Copy details</button>
    <p role="status">{dataCopyStatus}</p>
  </section>;
  return <section aria-label="Stamina check" className="stamina-layout">
    <div className="stamina-toolbar panel" ref={toolbar}>
      <div className="mode-switch"><div className="seg" role="group" aria-label="Course mode"><button type="button" aria-pressed={mode === 'draft'} disabled={running} onClick={() => { setMode('draft'); setPopover(undefined); }}>Draft</button><button type="button" disabled={running} aria-pressed={mode === 'any'} onClick={() => { setMode('any'); setPopover(undefined); }}>Any course</button></div></div>
      {mode === 'any' ? <><div className="toolbar-race">{trigger('race', 'Race', compactRace)}</div>
      <div className="condition-chips">{trigger('ground', 'Ground condition', groundNames[input.race.ground_condition - 1])}{trigger('weather', 'Weather', weatherNames[input.race.weather - 1])}{trigger('season', 'Season', seasonNames[input.race.season - 1])}</div></> : <div className="draft-toolbar-label"><span>{races.length} of 7 races known</span><small>{draft ? `Room ${draft.matchCode ?? "—"} · ${draft.phase === "complete" ? "draft complete" : "draft in progress"}` : "No live draft available"}</small></div>}
      <span className="toolbar-target">Target <b>{input.target}%</b></span>
      {running ? <button className="cancel-run" type="button" disabled={cancelling} onClick={() => { void cancel(); }}>{cancelling ? 'Cancelling…' : 'Cancel'}</button> : <button className="run" type="button" disabled={!ready || (mode === 'draft' ? !draft || !races.some(r => r.race) : !selectedCourse || !!selectedCourse.unavailable_reason)} onClick={() => { void run(); }}>{mode === 'draft' ? `Run ${races.filter(r => r.race).length} races` : 'Run check'}</button>}
      {popover && <div className={`stamina-popover panel popover-${popover}`} role="dialog" aria-label={popover === 'draft-course' ? 'Choose the course' : popover === 'race' ? 'Choose race' : `Choose ${popover}`} id="stamina-popover">
        <div className="popover-heading"><h2>{popover === 'draft-course' ? 'Choose the course' : popover === 'race' ? 'Race' : `Choose ${popover}`}</h2><button type="button" aria-label="Close picker" onClick={() => { setPopover(undefined); popupTrigger.current?.focus(); }}>×</button></div>
        {popover === 'draft-course' ? <>
          <p className="muted">Choose the exact course for this race. Its draft conditions are kept. Saved for room {courseChoice?.code} only.</p>
          <p className="course-source">{courseChoice?.raw}</p>
          <input className="draft-course-query" type="search" aria-label="Search pool courses" placeholder="Search track, distance, surface…" value={courseQuery} onChange={e => setCourseQuery(e.target.value)}/>
          <div className="pool-course-options">{catalog?.courses.filter(c => `${c.track_name} ${c.distance} ${c.surface === 1 ? 'Turf' : 'Dirt'} ${c.variant ?? ''}`.toLowerCase().includes(courseQuery.trim().toLowerCase())).map(c => <button type="button" key={c.id} disabled={!!c.unavailable_reason || running || courseChoice?.code !== draft?.matchCode} title={c.unavailable_reason ?? undefined} onClick={() => {
            if (!courseChoice || courseChoice.code !== draft?.matchCode || !races.some(r => r.choiceKey === courseChoice.key)) return;
            setCourseChoices(previous => ({ ...previous, [courseChoice.code]: { ...previous[courseChoice.code], [courseChoice.key]: c.id } }));
            setPopover(undefined); requestAnimationFrame(() => toolbar.current?.querySelector<HTMLButtonElement>(".run")?.focus());
          }}>{c.track_name} {c.distance} · {c.surface === 1 ? 'Turf' : 'Dirt'}{c.variant ? ` · ${c.variant}` : ''}{c.unavailable_reason ? ' · Unavailable' : ''}</button>)}{!catalog?.courses.some(c => `${c.track_name} ${c.distance} ${c.surface === 1 ? 'Turf' : 'Dirt'} ${c.variant ?? ''}`.toLowerCase().includes(courseQuery.trim().toLowerCase())) && <p role="status">No matching pool courses.</p>}</div>
        </> : popover === 'race' ? <>
          <div className="field"><span>Track</span><div className="course-chips" role="group" aria-label="Track">{[...new Set(catalog?.courses.map(c => c.track_name))].map(track => <button type="button" key={track} aria-pressed={selectedCourse?.track_name === track} onClick={() => patchRace({ map_id: catalog!.courses.find(c => c.track_name === track)!.id })}>{track}</button>)}</div></div>
          <div className="field"><span>Distance · surface · variant</span><div className="course-chips" role="group" aria-label="Race">{catalog?.courses.filter(c => c.track_name === selectedCourse?.track_name).map(c => <button type="button" key={c.id} title={c.unavailable_reason ?? undefined} aria-pressed={c.id === input.race.map_id} onClick={() => { patchRace({ map_id: c.id }); setPopover(undefined); popupTrigger.current?.focus(); }}>{c.distance} · {c.surface === 1 ? 'Turf' : 'Dirt'}{c.variant ? ` · ${c.variant}` : ''}{c.unavailable_reason ? ' · Unavailable' : ''}</button>)}</div></div>
        </> : <Segments label={popover === 'ground' ? 'Ground' : popover === 'weather' ? 'Weather' : 'Season'} value={popover === 'ground' ? input.race.ground_condition : popover === 'weather' ? input.race.weather : input.race.season} options={popover === 'ground' ? groundNames : popover === 'weather' ? weatherNames : seasonNames} onChange={value => { patchRace({ [popover === 'ground' ? 'ground_condition' : popover]: value }); setPopover(undefined); popupTrigger.current?.focus(); }}/>}</div>}
    </div>
    {!ready && !error && <p role="status">Loading engine data…</p>}
    {mode === 'any' && selectedCourse?.unavailable_reason && <p role="status">{selectedCourse.unavailable_reason}</p>}
    {running && <div className="simulation-progress" role="status" aria-live="polite"><span>{mode === 'draft' && progress?.race_total ? `Race ${progress.race_index! + 1} of ${progress.race_total} · ` : ''}{stageLabel}</span><progress aria-label="Simulation progress" aria-valuetext={stageLabel} max={100} value={progress?.percent ?? 0}/><b className="progress-percent">{Math.floor(progress?.percent ?? 0)}%</b></div>}
    {error && <div role="alert" className={`stamina-notice ${/cancelled/i.test(error) ? "cancelled" : "engine-error"}`}><b>{/cancelled/i.test(error) ? "Check cancelled" : "Engine error"}</b><p>{error}</p>{mode === "draft" && finished.length > 0 && <p>Finished races are kept below.</p>}</div>}{saveError && <p role="status" className="muted">{saveError}</p>}
    <div className={`stamina-workspace has-build${buildCollapsed ? " build-collapsed" : ""}`}>
    <section className={`stamina-results${running && mode === "any" && result ? " previous-result" : ""}`} aria-label="Result">
      {ready && !buildCustomized && <p className="default-build-prompt">Using the default Pace build — <button type="button" aria-label="Edit default build" onClick={() => openBuild('build')}>Edit build</button></p>}
      {mode === 'draft' ? !draft && !draftRun ? <div className="panel result-empty"><h2>No draft available</h2><p>Share a live room from Uma Drafter to check its races, or choose Any course.</p></div> : <>
        {draftRun && fingerprint !== draftRun.fingerprint && <p className="stale-notice" role="status">Draft changed since this run</p>}
        {draftRun && canonicalJson(engineInput) !== canonicalJson({ ...draftRun.input, request_id: '' }) && <p className="stale-notice" role="status">Inputs changed since this run; press Run check to update</p>}
        {detail !== undefined && draftRun?.results[detail] ? <><button type="button" className="back-to-draft" onClick={() => setDetail(undefined)}>← Back to draft races</button><div className="race-detail-heading"><h2>{courseLabel(draftRun.results[detail]!.course)}</h2><p className="muted">{groundNames[draftRun.results[detail]!.input.race.ground_condition - 1]} · {weatherNames[draftRun.results[detail]!.input.race.weather - 1]} · {seasonNames[draftRun.results[detail]!.input.race.season - 1]}</p></div><StaminaResults result={draftRun.results[detail]!} course={courseLabel(draftRun.results[detail]!.course)} skills={catalog?.skills ?? []}/></> : <>
          <div className="panel draft-summary"><h2>{finished.length ? <>{Number.isFinite(maxNeed) ? `Needs up to ${Math.round(maxNeed).toLocaleString('en-US')} effective stamina` : 'Joint threshold not reached through 2,000 raw stamina'} · you have {Math.min(...available).toLocaleString('en-US')}{Math.min(...available) !== Math.max(...available) ? '–' + Math.max(...available).toLocaleString('en-US') : ''} · short on {short} of {finished.length}</> : 'One build for your draft races'}</h2><p className="muted">{finished.length} of 7 finished · {draftRun?.input.target ?? input.target}% full spurt + survival.{shownRaces.length < 7 ? ' Remaining races appear as the draft progresses.' : ''}{finished.length > 0 && Math.min(...available) !== Math.max(...available) ? ' Heal equivalents vary by course distance.' : ''}</p></div>
          <div className="draft-race-table" role="table" aria-label="Draft race results">
            <div className="draft-race-columns" role="row"><span role="columnheader" className="sr-only">Number</span><span role="columnheader">Race</span><span role="columnheader">Needed</span><span role="columnheader">You have</span><span role="columnheader">Result</span></div>
            <div className="draft-races" role="rowgroup">{Array.from({ length: 7 }, (_, i) => {
              const slot = shownRaces[i], data = draftRun?.results[i];
              const state = data ? passes(data) ? 'race-pass' : 'race-short' : slot?.reason ? 'race-unknown' : '';
              const margin = data && data.needed_effective_stamina.joint !== null ? Math.round(data.effective_stamina - data.needed_effective_stamina.joint) : undefined;
              return <div role="row" className={state} key={i}><button type="button" disabled={!data} onClick={() => setDetail(i)} aria-label={`Race ${i + 1}: ${slot?.label ?? 'Awaiting draft race'}`}>
                <span className="race-number" role="cell">{i + 1}</span><span className="draft-race-name" role="cell"><strong>{slot?.label ?? 'Awaiting draft race'}</strong><small>{slot?.race ? `${groundNames[slot.race.ground_condition - 1]} · ${weatherNames[slot.race.weather - 1]} · ${seasonNames[slot.race.season - 1]}` : slot?.reason ?? (slot ? 'Not run yet' : 'Not selected yet')}</small>{slot?.reason && <small>{slot.raw}</small>}</span>
                <span className="race-value" role="cell">{data ? data.needed_effective_stamina.joint === null ? 'Not reached' : Math.round(data.needed_effective_stamina.joint).toLocaleString('en-US') : '—'}</span>
                <span className="race-value" role="cell">{data ? Math.round(data.effective_stamina).toLocaleString('en-US') : '—'}</span>
                <span className="race-outcome" role="cell">{data ? `${passes(data) ? 'Pass' : 'Short'}${margin !== undefined ? ` ${margin >= 0 ? '+' : '−'}${Math.abs(margin).toLocaleString('en-US')}` : ''}` : slot?.reason ? 'Can’t run' : running && i === batchSlots.current?.[progress?.race_index ?? 0] ? 'Running…' : slot?.race ? running ? 'Queued' : 'Not run' : 'Waiting'}</span>
              </button>{slot?.choiceKey && !slot.course && <div className="course-choice-action"><button type="button" disabled={running || !draft?.matchCode} onClick={e => { if (!draft?.matchCode) return; setCourseChoice({ code: draft.matchCode, key: slot.choiceKey!, raw: slot.raw }); setCourseQuery(''); toggle('draft-course', e.currentTarget); }}>Choose the course</button><button type="button" disabled={running} onClick={() => { void copyCourseDiagnostics(slot, i + 1); }}>Copy diagnostics</button>{!draft?.matchCode && <small>A match code is needed to remember a course choice.</small>}</div>}</div>;
            })}</div>
          </div>
        </>}
      </> : result ? <>{canonicalJson(engineInput) !== canonicalJson({ ...result.data.input, request_id: '' }) && <p className="stale-notice" role="status">Inputs changed since this run; press Run check to update</p>}<StaminaResults result={result.data} course={result.course} skills={catalog?.skills ?? []}/></> : <div className="panel result-empty"><h2>How much stamina do you need?</h2><p>Choose a race and build, then run a check. Your answer measures full spurt and survival together in at least {input.target}% of races.</p><p className="muted">Thresholds are refined to 10 stamina. Estimates use finite samples.</p></div>}
      <footer>Simulated with uma-race-simulator (MIT). Game data © Cygames.</footer>
    </section>
    {catalog && (buildCollapsed ? <aside className="build-rail panel" aria-label="Build panel, collapsed"><button ref={expandButton} type="button" aria-label="Expand build panel" aria-expanded="false" onClick={() => toggleBuild(false)}>‹</button><span>{roleNames[strategy(input.build) - 1]} · {input.build.skills.length} {input.build.skills.length === 1 ? 'skill' : 'skills'}</span></aside> : <aside ref={drawer} className="build-drawer desktop-tool panel" aria-label="Build editor">
      <div className="drawer-heading"><div><span className="label">Your uma</span><h2>Build editor</h2><small className="muted">{roleNames[strategy(input.build) - 1]} · {input.build.skills.length} {input.build.skills.length === 1 ? 'skill' : 'skills'}</small></div><button ref={collapseButton} type="button" aria-label="Collapse build panel" aria-expanded="true" onClick={() => toggleBuild(true)}>›</button></div>
      {running && <p className="build-lock" role="status">Build locked while the check runs</p>}
      <div className="build-fields">
      <div className="drawer-tabs" role="tablist" aria-label="Build panel"><button type="button" role="tab" disabled={running} aria-selected={buildTab === 'build'} onClick={() => openBuild('build')}>Build</button><button type="button" role="tab" disabled={running} aria-selected={buildTab === 'presets'} onClick={() => openBuild('presets')}>Presets</button><button type="button" role="tab" disabled={running} aria-selected={buildTab === 'race-settings'} onClick={() => openBuild('race-settings')}>Race settings</button></div>
      <div className="build-body" role="tabpanel" aria-label={buildTab === 'build' ? 'Build' : buildTab === 'presets' ? 'Presets' : 'Race settings'}><fieldset disabled={running} className="build-controls">
        {buildTab === 'race-settings' ? <RaceSettings input={input} onChange={patch} onMood={motivation => patchBuild({ motivation })}/> : buildTab === 'presets' ? <>{presetError && <p role="status">{presetError}</p>}{presets ? <StaminaPresets catalog={catalog} memory={presets} onChange={changePresets} build={input.build} onLoad={build => { patchBuild({ ...build, umaCardId: build.umaCardId }); setBuildTab('build'); }} recent={recent} onRecent={setRecent}/> : <p>Loading presets…</p>}</> : <>
        <StaminaUmaPicker umas={catalog.umas} selected={selectedUma} uniques={uniques} full={ordinary.length >= 100} onSelect={uma => patchBuild(selectUma(input.build, uma, catalog))} onAptitudes={patchBuild} onLevel={(id, level) => patchBuild({ skills: input.build.skills.map(skill => skill.id === id ? { id, level } : skill) })}/>
        <Segments label="Strategy" value={strategy(input.build)} options={roleNames} onChange={value => patchBuild(withStrategy(input.build, value))}/>
        <div className="raw-stats">{(['speed', 'stamina', 'pow', 'guts', 'wiz'] as const).map(stat => <label key={stat}>{({ speed: 'Speed', stamina: 'Stamina', pow: 'Power', guts: 'Guts', wiz: 'Wit' })[stat]}<NumberField className={`num ${stat === 'stamina' ? 'stamina-input' : ''}`} aria-label={stat === 'pow' ? 'Power' : stat === 'wiz' ? 'Wit' : stat[0]!.toUpperCase() + stat.slice(1)} required min={1} max={2000} value={input.build.stats[stat]} onChange={value => patchBuild({ stats: { ...input.build.stats, [stat]: value } })}/></label>)}</div>
        <div className="field"><span>Aptitudes</span>{(['distance', 'style', 'ground'] as const).map(group => <div className={`aptitude-grid aptitude-${group}`} key={group}>{({ distance: ['Sprint', 'Mile', 'Medium', 'Long'], style: styles, ground: ['Turf', 'Dirt'] })[group].map((name, i) => aptitude(group, i, `${name} aptitude`))}</div>)}</div>
        <div className="field"><span>Skills · your uma only</span>{notice && <small className="muted" role="status">Local skill data unavailable. Using engine names without icons.</small>}<SkillPicker catalog={catalog} skills={ordinary} onChange={skills => patchBuild({ skills: [...skills, ...uniques.map(unique => unique.skill)] })} recent={recent} onRecent={setRecent} limit={100 - uniques.length}/></div>
        </>}
      </fieldset></div>
      </div>
      <div className="drawer-footer"><span className="muted">Inputs remembered automatically</span></div>
    </aside>)}
    </div>
    <p role="status" aria-live="polite">{copyStatus}</p>
  </section>;
}
