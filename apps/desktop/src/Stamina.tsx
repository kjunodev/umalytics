import { NumberField } from './NumberField';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DraftSnapshot } from '@umalytics/shared';
import { StaminaPresets } from './StaminaPresets';
import { loadPresets, savePresets, restorePresets, type PresetMemory } from './staminaPresetState';
import { draftRaces, draftFingerprint, unknownCourseDiagnostics, passes, type DraftRace, type CourseChoices } from './staminaDraft';
import { StaminaResults } from './StaminaResults';
import { StaminaUmaPicker } from './StaminaUmaPicker';
import { StaminaScreenshotImport } from './StaminaScreenshotImport';
import { StaminaBuildSkills } from './StaminaBuildSkills';
import { importedBuildSkills, tierChains, type ScreenshotImport } from './staminaScreenshot';
import { applyScreenshotBuild, buildTabLabels, editorStats, loadStaminaMemory, recentUmaLimit, saveStaminaMemory, selectUma, staminaStatLabels, undoScreenshotBuild, type BuildTab, type StaminaView } from './staminaState';
import { RaceSettings } from './RaceSettings';
import { defaultStaminaInput, defaultStamina, groundNames, weatherNames, seasonNames, staminaEngineInput, type Catalog, type StaminaEditorBuild, type StaminaEditorInput, type StaminaInput, type StaminaProgress, type StaminaResult, type StaminaRaceResult, roleNames, strategy, withStrategy } from './staminaTypes';
import { formatStamina, raceName, staminaMargin } from './staminaAnswers';
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

export function Stamina({ draft, openDraft = 0, view, onViewChange, onDraftRunChange, onDataError }: {
  draft?: DraftSnapshot; openDraft?: number; view: StaminaView; onViewChange: (view: StaminaView) => void;
  onDraftRunChange?: (run: DraftRun | undefined) => void; onDataError: (failed: boolean) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [anyInput, setAnyInput] = useState<StaminaEditorInput>(() => ({ ...defaultStaminaInput, build: { ...defaultStaminaInput.build, usesDefaultStamina: true } }));
  const [draftInput, setDraftInput] = useState<StaminaEditorInput>(() => structuredClone(anyInput));
  const [mode, setMode] = useState<'draft' | 'any'>('any');
  const input = mode === 'draft' ? draftInput : anyInput, setInput = mode === 'draft' ? setDraftInput : setAnyInput;
  const [importOpen, setImportOpen] = useState(false);
  const screenshotSkills = catalog?.screenshot_import_enabled ? catalog.screenshot_skills : undefined;
  const screenshotImport = screenshotSkills ? input.screenshotImport : undefined;
  const importedChains = useMemo(() => screenshotImport && screenshotSkills ? tierChains(screenshotImport.observations, screenshotSkills) : [], [screenshotImport, screenshotSkills]);
  const [buildTab, setBuildTab] = useState<BuildTab>('build');
  const [buildCustomized, setBuildCustomized] = useState(false);
  const [presets, setPresets] = useState<PresetMemory>();
  const fallbackStamina = presets?.defaults.stats.stamina ?? defaultStamina;
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
  const [recentUmas, setRecentUmas] = useState<number[]>([]);
  const rememberUma = (id: number) => setRecentUmas(previous => [id, ...previous.filter(value => value !== id)].slice(0, recentUmaLimit));
  const [popover, setPopover] = useState<Popover>();
  const [notice, setNotice] = useState(false), [error, setError] = useState(''), [saveError, setSaveError] = useState('');
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<StaminaProgress>();
  const [result, setResult] = useState<StaminaResult>();
  const active = useRef<string | null>(null), toolbar = useRef<HTMLDivElement>(null);
  const popupTrigger = useRef<HTMLButtonElement | null>(null), drawer = useRef<HTMLElement>(null);
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
        if (memory) { setAnyInput(memory.input); setDraftInput(memory.draftInput ?? structuredClone(memory.input)); setRecent(memory.recent); setRecentUmas(memory.recentUmas); onViewChange(memory.view); setBuildTab(memory.buildTab); setBuildCustomized(memory.buildCustomized ?? false); setCourseChoices(memory.courseChoices ?? {}); }
        if (!data.local_skill_data && !missingDataNoticeShown) { missingDataNoticeShown = true; setNotice(true); }
      }
      try { const saved = await loadPresets(data); if (!disposed) { setPresets(saved); setPresetWritable(true); } }
      catch { if (!disposed) { setPresets(restorePresets(undefined, data)); setPresetError('Presets could not be loaded. Changes will not be saved until reload.'); } }
      if (!disposed) setReady(true);
    })().catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; stops.forEach(stop => stop()); if (active.current) void invoke('cancel_stamina_check').catch(() => {}); active.current = null; };
  }, []);

  useEffect(() => {
    if (ready) void saveStaminaMemory({ input: anyInput, draftInput, recent, recentUmas, view, buildTab, buildCustomized, courseChoices }, !!screenshotSkills).then(() => setSaveError('')).catch(() => setSaveError('Inputs could not be saved. Your current build is still available.'));
  }, [ready, anyInput, draftInput, recent, recentUmas, view, buildTab, buildCustomized, courseChoices, screenshotSkills]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (popover) { setPopover(undefined); popupTrigger.current?.focus(); }
    };
    const outside = (e: PointerEvent) => { if (popover && !toolbar.current?.contains(e.target as Node)) setPopover(undefined); };
    document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); };
  }, [popover]);
  useEffect(() => { if (popover) toolbar.current?.querySelector<HTMLElement>(popover === 'draft-course' ? '.draft-course-query' : '.stamina-popover button, .stamina-popover select')?.focus(); }, [popover]);
  useEffect(() => { setPopover(current => current === 'draft-course' ? undefined : current); }, [draft?.matchCode]);

  const patch = (next: Partial<StaminaEditorInput>) => setInput(previous => ({ ...previous, ...next }));
  const patchBuild = (next: Partial<StaminaEditorBuild>) => { setBuildCustomized(true); setInput(previous => ({ ...previous, build: { ...previous.build, ...next } })); };
  const changeImport = (scan: ScreenshotImport, imported?: Partial<StaminaEditorBuild>) => {
    if (!screenshotSkills) return;
    const skills = importedBuildSkills(scan, tierChains(scan.observations, screenshotSkills), screenshotSkills);
    if (skills.length > 100) return;
    setBuildCustomized(true);
    setInput(previous => imported ? applyScreenshotBuild(previous, { ...imported, skills }, scan)
      : { ...previous, screenshotImport: scan, build: { ...previous.build, skills } });
  };
  const changeUniqueLevel = (id: number, level: number) => {
    if (screenshotImport) {
      changeImport({ ...screenshotImport, observations: screenshotImport.observations.map(row => row.owned && row.id === id ? { ...row, level } : row) });
    } else patchBuild({ skills: input.build.skills.map(skill => skill.id === id ? { id, level } : skill) });
  };
  const openBuild = (tab: BuildTab) => { setBuildTab(tab); setPopover(undefined); };
  const copyCourseDiagnostics = async (slot: DraftRace, raceNumber: number) => {
    try { const version = await getVersion(); await navigator.clipboard.writeText(unknownCourseDiagnostics(draft?.matchCode, raceNumber, slot, version, catalog?.engine_data_version)); setCopyStatus('Diagnostics copied'); }
    catch { setCopyStatus('Unable to copy diagnostics.'); }
  };
  const patchRace = (next: Partial<StaminaInput['race']>) => setInput(previous => ({ ...previous, race: { ...previous.race, ...next } }));
  const races = catalog ? draftRaces(draft, catalog, courseChoices) : [];
  const fingerprint = draftFingerprint(draft, races);
  const run = async () => {
    if (!drawer.current?.querySelectorAll('input:invalid').length && ready) {
      const request_id = crypto.randomUUID(), submitted = { ...engineInput, request_id };
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
          if (active.current === request_id) { setResult(data); setProgress({ request_id, map_id: data.input.race.map_id, completed: data.races, total: data.races, stage: 'done', percent: 100 }); }
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
  const engineInput = staminaEngineInput({ ...input, request_id: '' }, fallbackStamina);
  const lastInput = mode === 'draft' ? draftRun?.input : result?.input;
  const staleInputs = lastInput && canonicalJson(engineInput) !== canonicalJson({ ...lastInput, request_id: '' });
  const compactRace = selectedCourse ? `${selectedCourse.track_name} ${selectedCourse.distance} · ${selectedCourse.surface === 1 ? 'Turf' : 'Dirt'}${selectedCourse.variant ? ` · ${selectedCourse.variant}` : ''}` : 'Choose race';
  const toggle = (name: Popover, target: HTMLButtonElement) => { popupTrigger.current = target; setPopover(popover === name ? undefined : name); };
  const trigger = (name: Popover, label: string, content: ReactNode) => <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={popover === name} aria-controls={popover === name ? 'stamina-popover' : undefined} disabled={!ready || running} onClick={e => toggle(name, e.currentTarget)}>{content}</button>;
  const aptitude = (group: 'distance' | 'style' | 'ground', i: number, label: string) => <Picker key={label} label={label} value={input.build[group][i]!} options={grades} onChange={value => { const values = [...input.build[group]]; values[i] = value; patchBuild({ [group]: values }); }}/>;
  const stageLabel = progress?.stage === 'done' ? (progress.percent === 100 ? 'Done' : 'Race finished') : progress?.stage === 'refining' ? 'Refining thresholds' : 'Mapping the curve';
  const shownRaces = draftRun?.slots.map((slot, i) => !draftRun.results[i] && races[i]?.raw === slot.raw ? races[i]! : slot) ?? races;
  const finished = (draftRun?.results ?? []).filter((r): r is StaminaResult => !!r);
  const short = finished.filter(r => !passes(r));
  const worst = short.reduce<StaminaResult | undefined>((current, race) =>
    !current || (race.thresholds.joint ?? Infinity) > (current.thresholds.joint ?? Infinity) ? race : current, undefined);
  const assessment = view === 'assessment';
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
    <div className={`stamina-workspace${catalog ? ' has-build' : ''}`}>
    <section className={`stamina-results${running && mode === 'any' && result ? ' previous-result' : ''}`} aria-label="Result">
      {mode === 'draft' ? !draft && !draftRun ? <div className="panel result-empty"><h2>No draft available</h2><p>Share a live room from Uma Drafter to check its races, or choose Any course.</p></div> : <>
        {draftRun && fingerprint !== draftRun.fingerprint && <p className="stale-notice" role="status">Draft changed since this run</p>}
        {detail !== undefined && draftRun?.results[detail] ? <>
          <button type="button" className="back-to-draft" onClick={() => setDetail(undefined)}>← Back to draft races</button>
          <StaminaResults result={draftRun.results[detail]!} view={view} skills={catalog?.skills ?? []}/>
        </> : <>
          <div className="draft-summary">
            <h2>{assessment && finished.length ? short.length ? `Short on ${short.length} of ${finished.length} races · worst ${raceName(worst!.course)}` : `Enough for all ${finished.length} checked races` : 'Draft races'}</h2>
            <p className="muted">{finished.length} of 7 checked · {draftRun?.input.target ?? input.target}% target</p>
          </div>
          <div className="draft-race-table">
            <table className={assessment ? 'assessment-ledger' : 'requirement-ledger'} aria-label="Draft race results">
              <colgroup><col/><col className="ledger-value"/>{assessment && <><col className="ledger-value"/><col className="ledger-margin"/></>}</colgroup>
              <thead><tr><th scope="col">Race</th><th scope="col">Need</th>{assessment && <><th scope="col">You</th><th scope="col">Margin</th></>}</tr></thead>
              <tbody>{Array.from({ length: 7 }, (_, i) => {
                const slot = shownRaces[i], data = draftRun?.results[i];
                const state = data && assessment ? passes(data) ? 'race-pass' : 'race-short' : slot?.reason ? 'race-unknown' : '';
                const margin = data ? staminaMargin(data) : null;
                const pending = slot?.reason ? 'Can’t run' : running && i === batchSlots.current?.[progress?.race_index ?? 0] ? 'Running…' : slot?.race ? running ? 'Queued' : 'Not run' : 'Waiting';
                return <tr className={state} key={i}>
                  <th scope="row">
                    <div className="ledger-race">
                      <span className="race-number">{i + 1}</span>
                      <span className="draft-race-name">{data ?
                        <button type="button" className="draft-race-link" onClick={() => setDetail(i)} aria-label={`Race ${i + 1}: ${slot?.label}`}>{slot?.label}</button>
                        : <strong>{slot?.label ?? 'Awaiting draft race'}</strong>}
                        <small>{slot?.reason ?? (data && slot?.race ? `${groundNames[slot.race.ground_condition - 1]} · ${weatherNames[slot.race.weather - 1]} · ${seasonNames[slot.race.season - 1]}` : pending)}</small>
                        {slot?.reason && <small>{slot.raw}</small>}
                      </span>
                    </div>
                    {slot?.choiceKey && !slot.course && <div className="course-choice-action"><button type="button" disabled={running || !draft?.matchCode} onClick={e => { if (!draft?.matchCode) return; setCourseChoice({ code: draft.matchCode, key: slot.choiceKey!, raw: slot.raw }); setCourseQuery(''); toggle('draft-course', e.currentTarget); }}>Choose the course</button><button type="button" disabled={running} onClick={() => { void copyCourseDiagnostics(slot, i + 1); }}>Copy diagnostics</button>{!draft?.matchCode && <small>A match code is needed to remember a course choice.</small>}</div>}
                  </th>
                  <td className="race-value">{data ? data.thresholds.joint === null ? '>2,000' : formatStamina(data.thresholds.joint) : '—'}</td>
                  {assessment && <>
                    <td className="race-value">{data ? formatStamina(data.current.stamina) : '—'}</td>
                    <td className="race-outcome">{margin === null ? data ? 'Below target' : '—' : <>
                      {margin === 0 ? '0' : `${margin > 0 ? '+' : '−'}${formatStamina(Math.abs(margin))}`}
                      <span className={`margin-bar${margin < 0 ? ' negative' : ''}`} aria-hidden="true"><i style={{ width: `${Math.min(50, Math.abs(margin) / 8)}%` }}/></span>
                    </>}</td>
                  </>}
                </tr>;
              })}</tbody>
            </table>
          </div>
        </>}
      </> : result ? <StaminaResults result={result} view={view} skills={catalog?.skills ?? []}/> : <div className="panel result-empty">
        <h2>{assessment ? 'Does your build have enough stamina?' : 'How much stamina do you need?'}</h2>
        <p>Choose a race and build, then run a check.</p>
      </div>}
      {ready && !buildCustomized && <p className="default-build-prompt">Using the default Pace build · <button type="button" aria-label="Edit default build" onClick={() => openBuild('build')}>Edit build</button></p>}
      {staleInputs && <p className="stale-notice" role="status">Inputs changed since this run. Run the check again to update.</p>}
      <footer>Simulated with uma-race-simulator (MIT). Game data © Cygames.</footer>
    </section>
    {catalog && <aside ref={drawer} className="build-drawer panel" data-tab={buildTab} aria-label="Build editor">
      {screenshotSkills && <div className="build-import-actions">
          <button type="button" className="import-trigger" disabled={running} onClick={() => setImportOpen(true)}>Import from screenshots</button>
          {input.importUndo && <button type="button" disabled={running} onClick={() => { setInput(undoScreenshotBuild); openBuild('build'); }}>Undo import</button>}
      </div>}
      <div className="drawer-tabs" role="tablist" aria-label="Build panel">{(Object.keys(buildTabLabels) as BuildTab[]).map(tab =>
        <button key={tab} id={`build-tab-${tab}`} type="button" role="tab" disabled={running} aria-selected={buildTab === tab} aria-controls="stamina-build-tab" onClick={() => openBuild(tab)}>{buildTabLabels[tab]}</button>)}</div>
      <div key={buildTab} className="build-body" id="stamina-build-tab" role="tabpanel" aria-labelledby={`build-tab-${buildTab}`}>
        {buildTab === 'build' ? <>
          <fieldset disabled={running} className="build-controls build-attributes" aria-label="Attributes">
            <StaminaUmaPicker umas={catalog.umas} selected={selectedUma} recent={recentUmas} hasUnique={!!uniques.length} locked={!!screenshotImport} full={ordinary.length >= 100}
              onSelect={uma => { if (uma) rememberUma(uma.card_id); patchBuild(selectUma(input.build, uma, catalog)); }} onAptitudes={patchBuild}/>
            <Segments label="Strategy" value={screenshotImport ? input.build.running_style : strategy(input.build)} options={screenshotImport ? styles : roleNames} onChange={value => patchBuild(screenshotImport ? { running_style: value } : withStrategy(input.build, value))}/>
            <div className={`raw-stats${assessment ? '' : ' without-stamina'}`}>{editorStats(view).map(stat =>
              <label key={stat}>{staminaStatLabels[stat]}<NumberField className={`num${stat === 'stamina' ? ' stamina-input' : ''}`} aria-label={staminaStatLabels[stat]} required min={1} max={2000}
                value={engineInput.build.stats[stat]} onChange={value => patchBuild({ stats: { ...input.build.stats, [stat]: value }, ...(stat === 'stamina' ? { usesDefaultStamina: undefined } : {}) })}/></label>)}</div>
            <div className="field"><span>Aptitudes</span>{(['distance', 'style', 'ground'] as const).map(group => <div className={`aptitude-grid aptitude-${group}`} key={group}>{({ distance: ['Sprint', 'Mile', 'Medium', 'Long'], style: styles, ground: ['Turf', 'Dirt'] })[group].map((name, i) => aptitude(group, i, `${name} aptitude`))}</div>)}</div>
          </fieldset>
          <StaminaBuildSkills catalog={catalog} scan={screenshotImport} chains={importedChains} skills={ordinary} uniques={uniques} running={running} notice={notice}
            recent={recent} onRecent={setRecent} onScan={changeImport} onRemoveScan={() => patch({ screenshotImport: undefined })}
            onManual={skills => screenshotImport ? changeImport({ ...screenshotImport, manualSkills: skills.map(skill => skill.id) }) : patchBuild({ skills: [...skills, ...uniques.map(unique => unique.skill)] })}
            onLevel={changeUniqueLevel}/>
        </> : <fieldset disabled={running} className="build-controls">{buildTab === 'race' ? <RaceSettings input={input} onChange={patch} onMood={motivation => patchBuild({ motivation })}/>
        : <>
          {presetError && <p role="status">{presetError}</p>}
          {presets ? <StaminaPresets catalog={catalog} memory={presets} onChange={changePresets} build={input.build} onLoad={build => {
            setBuildCustomized(true); setInput(previous => ({ ...previous, screenshotImport: undefined, build })); openBuild('build');
          }} recent={recent} onRecent={setRecent}/> : <p>Loading presets…</p>}
        </>}</fieldset>}
      </div>
    </aside>}
    </div>
    {copyStatus && <p role="status" aria-live="polite">{copyStatus}</p>}
    {importOpen && catalog && screenshotSkills && <StaminaScreenshotImport catalog={catalog} recent={recent} recentUmas={recentUmas} onRecent={setRecent} onUmaPicked={rememberUma} onClose={() => setImportOpen(false)}
      onApply={(build, scan) => { changeImport(scan, build); setImportOpen(false); openBuild('build'); }}/>}
  </section>;
}
