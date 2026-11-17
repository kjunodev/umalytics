import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { SkillPicker } from './SkillPicker';
import { StaminaUmaPicker } from './StaminaUmaPicker';
import { importApplyLabel, importGuide, importGuideProgress, type ImportGuide } from './staminaImportGuide';
import { purchasePlan, tierChains, type Observation, type Screen, type Screenshot, type ScreenshotImport } from './staminaScreenshot';
import type { Catalog, StaminaEditorBuild } from './staminaTypes';

const screens: Record<Screen, string> = {
  'attributes-numbers': 'Career Attributes · Number view',
  'attributes-chart': 'Career Attributes · Chart view',
  'career-skills': 'Career Skills',
  'details-skills': 'Uma Details · Skills',
  'details-conditions': 'Uma Details · Conditions',
  'finished-details': 'Finished Uma Details · Skills',
  learn: 'Learn',
  unsupported: 'Unsupported screenshot',
};
const skillScreens: ReadonlySet<Screen> = new Set(['career-skills', 'details-skills', 'finished-details', 'learn']);
const stats = [
  ['speed', 'Speed'], ['stamina', 'Stamina'], ['pow', 'Power'], ['guts', 'Guts'], ['wiz', 'Wit'],
] as const;
const grades = 'GFEDCBAS';
const aptitudes = [
  ['track', 'Track', ['Turf', 'Dirt']],
  ['distance', 'Distance', ['Sprint', 'Mile', 'Medium', 'Long']],
  ['style', 'Style', ['Front', 'Pace', 'Late', 'End']],
] as const;
type Source = { id: number; scan: Screenshot; error?: never } | { id: number; error: string; scan?: never };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
// A fast close and reopen must release the old registration before taking the shortcut again.
let shortcutQueue = Promise.resolve();
let nextScanId = 0;
type ScanUpdate = { type: 'queued'; value: number } | { type: 'screenshot'; value: Screenshot } | { type: 'finished'; value: string | null };
type ScrollingSession = { id: number; started: Promise<void>; stopping?: boolean };
type ApplyBlock = { reason: string; focus: string };
const stopScrolling = (id: number, drain: boolean) => invoke('stop_stamina_scrolling_scan', { id, drain });
const validNumber = (text: string, min: number, max: number) => text !== '' &&
  Number.isInteger(Number(text)) && Number(text) >= min && Number(text) <= max;

async function scanImage(file: File) {
  if (file.size > 32 * 1024 * 1024) throw Error('Choose an image under 32 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw Error('Could not open this image.'); });
  try {
    const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
    if (file.type === 'image/png' && scale === 1) return await invoke<Screenshot>('scan_stamina_screenshot', await file.arrayBuffer());
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('Could not prepare this image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw Error('Could not prepare this image.');
    return await invoke<Screenshot>('scan_stamina_screenshot', await png.arrayBuffer());
  } finally { bitmap.close(); }
}

export function StaminaScreenshotImport({ catalog, recent, recentUmas, onRecent, onUmaPicked, onClose, onApply }: {
  catalog: Catalog;
  recent: number[];
  recentUmas: number[];
  onRecent: (ids: number[]) => void;
  onUmaPicked: (id: number) => void;
  onClose: () => void;
  onApply: (build: Pick<StaminaEditorBuild, 'umaCardId' | 'stats' | 'ground' | 'distance' | 'style'>, scan: ScreenshotImport) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const queue = useRef(Promise.resolve());
  const closed = useRef(false);
  const capturing = useRef(false);
  const session = useRef<ScrollingSession>(undefined);
  const applying = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pending, setPending] = useState(0);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string>();
  const [captureToast, setCaptureToast] = useState(false);
  const [scanGuide, setScanGuide] = useState<ImportGuide>();
  const [guideChoice, setGuideChoice] = useState<ImportGuide>();
  const [stopping, setStopping] = useState(false);
  const [queued, setQueued] = useState(0);
  const [read, setRead] = useState(0);
  const [applyQueued, setApplyQueued] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const [hotkeyReady, setHotkeyReady] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string>();
  const [pickerError, setPickerError] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [chosen, setChosen] = useState<number>();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<Record<string, number | undefined>>({});
  useEffect(() => {
    const element = dialog.current;
    closed.current = false;
    element?.showModal();
    return () => {
      closed.current = true;
      clearTimeout(toastTimer.current);
      const active = session.current;
      session.current = undefined;
      if (active) void active.started.then(() => stopScrolling(active.id, false)).catch(console.error);
      element?.close();
    };
  }, []);

  const addSource = useCallback((source: Source) => {
    setSources(previous => [...previous, source].sort((a, b) => a.id - b.id));
  }, []);
  const capture = useCallback(async (fromButton: boolean) => {
    if (closed.current || capturing.current || applying.current) return;
    capturing.current = true;
    setCaptureBusy(true);
    setCaptureError(undefined);
    setCaptureToast(false);
    clearTimeout(toastTimer.current);
    const id = nextId.current++;
    try {
      const scan = await invoke<Screenshot>('capture_stamina_screenshot', { fromButton });
      if (closed.current) return;
      addSource({ id, scan });
      setCaptureToast(true);
      toastTimer.current = setTimeout(() => setCaptureToast(false), 2400);
    } catch (error) {
      if (!closed.current) setCaptureError(message(error));
    } finally {
      capturing.current = false;
      if (!closed.current) setCaptureBusy(false);
    }
  }, [addSource]);
  const stopScan = () => {
    const active = session.current;
    if (!active || active.stopping) return;
    active.stopping = true;
    setStopping(true);
    void active.started.then(() => stopScrolling(active.id, true)).catch(error => {
      if (closed.current || session.current !== active) return;
      active.stopping = false;
      setStopping(false);
      setScanError(message(error));
    });
  };
  const startScan = (guide: ImportGuide) => {
    if (session.current || applying.current) return;
    const id = ++nextScanId;
    setScanGuide(guide);
    setScanError(undefined);
    setQueued(0);
    setRead(0);
    const complete = (error?: string) => {
      if (closed.current || session.current?.id !== id) return;
      session.current = undefined;
      setScanGuide(undefined);
      setStopping(false);
      if (error) setScanError(error);
    };
    const updates = new Channel<ScanUpdate>(update => {
      if (closed.current || session.current?.id !== id) return;
      if (update.type === 'queued') setQueued(update.value);
      else if (update.type === 'screenshot') {
        setRead(count => count + 1);
        const scan = update.value;
        if (scan.screen !== 'unsupported') addSource({ id: nextId.current++, scan });
      } else complete(update.value ?? undefined);
    });
    const started = invoke<void>('scan_stamina_while_scrolling', { id, updates, finishedUma: guide === 'finished' });
    session.current = { id, started };
    void started.catch(error => complete(message(error)));
  };
  useEffect(() => {
    let active = true;
    let registered = false;
    let unlisten: UnlistenFn | undefined;
    shortcutQueue = shortcutQueue.then(async () => {
      if (!active) return;
      try {
        unlisten = await listen('stamina-capture-hotkey', () => {
          if (active) void capture(false);
        });
        if (!active) return;
        await invoke('set_stamina_capture_hotkey', { enabled: true });
        registered = true;
        if (active) setHotkeyReady(true);
      } catch (error) {
        if (active) setHotkeyError(message(error));
      }
    });
    return () => {
      active = false;
      shortcutQueue = shortcutQueue.then(async () => {
        try {
          if (registered) await invoke('set_stamina_capture_hotkey', { enabled: false });
        } finally {
          await unlisten?.();
        }
      }).catch(error => console.error('Could not release the capture shortcut', error));
    };
  }, [capture]);

  const add = (files: File[]) => {
    if (!files.length || applying.current) return;
    setPickerError(false);
    setPending(count => count + files.length);
    for (const file of files) {
      const id = nextId.current++;
      queue.current = queue.current.then(async () => {
        if (closed.current) return;
        try {
          const scan = await scanImage(file);
          if (!closed.current) addSource({ id, scan });
        } catch (error) {
          if (!closed.current) addSource({ id, error: message(error) });
        } finally { if (!closed.current) setPending(count => count - 1); }
      });
    }
  };
  const finished = sources.some(source => source.scan?.screen === 'finished-details');
  const guide = guideChoice ?? (finished ? 'finished' : 'career');
  const guideSteps = importGuideProgress(guide, sources.flatMap(source => source.scan ? [source.scan] : []));
  const currentStep = guideSteps.indexOf(false);
  const mixed = finished && sources.some(source => source.scan && ['attributes-numbers', 'career-skills', 'details-skills', 'details-conditions', 'learn'].includes(source.scan.screen));
  const numbers = [...sources].reverse().find(({ scan }) => scan?.attributes &&
    (finished ? scan.screen === 'finished-details' : ['attributes-numbers', 'details-skills', 'details-conditions'].includes(scan.screen)))?.scan;
  const learn = sources.some(source => source.scan?.screen === 'learn');
  const points = [...new Set(sources.flatMap(({ scan }) => scan?.skill_points == null ? [] : [scan.skill_points]))];
  const cards = new Set(sources.flatMap(({ scan }) =>
    scan?.card && ['attributes-numbers', 'career-skills', 'details-skills', 'details-conditions', 'finished-details'].includes(scan.screen) ? [scan.card.id] : []));
  const cardId = chosen ?? numbers?.card?.id ?? (cards.size === 1 ? [...cards][0] : undefined);
  const uma = catalog.umas.find(card => card.card_id === cardId);
  const rows = sources.flatMap(({ id, scan }) => scan?.skills.map((row, index) => ({
    ...row, key: `${id}-${index}`, screen: scan.screen, smallPanel: scan.small_game_panel,
    learn: scan.screen === 'learn', owned: scan.screen !== 'learn' || row.fields.obtained === true,
  })) ?? []).sort((a, b) => Number(b.learn) - Number(a.learn));
  const canSimulate = (id: number) => Object.hasOwn(catalog.screenshot_skills ?? {}, id);
  const ignored = [...new Set(rows.flatMap(row => {
    if (row.resolution === 'ignored_no_race_effect') return [row.raw_name];
    const id = resolved[row.key];
    return id !== undefined && !canSimulate(id) ? [catalog.skills.find(skill => skill.id === id)?.name ?? row.raw_name] : [];
  }))];
  const unknown = rows.filter(row => row.resolution === null);
  const suggestions = unknown.flatMap(row => row.variant_choice?.suggested !== undefined && resolved[row.key] === undefined
    ? [[row.key, row.variant_choice.suggested] as const] : []);
  const resolve = (key: string, id: number | undefined) => setResolved(previous => ({ ...previous, [key]: id }));
  const stat = (i: number) => edits[stats[i]![0]] ?? numbers?.attributes?.stats[i]?.toString() ?? '';
  const aptitude = (key: typeof aptitudes[number][0], i: number) => {
    const value = edits[`${key}-${i}`] ?? numbers?.attributes?.[key][i] ?? '';
    return value && grades.includes(value) ? value : '';
  };
  const sp = edits.points ?? (points.length === 1 ? String(points[0]) : '');
  const observations = rows.flatMap<Observation>(row => {
    if (row.resolution === 'ignored_no_race_effect') return [];
    const id = row.resolution?.matched.id ?? resolved[row.key];
    if (id === undefined || !canSimulate(id)) return [];
    return [{ id, owned: row.owned, learn: row.learn, level: row.fields.level, price: row.fields.cost,
      hint: row.fields.hint, hintUnreadable: row.fields.hint_unreadable, hintConflict: row.fields.hint_conflict }];
  });
  const scannedLearnSkills = new Set(observations.filter(row => row.learn).map(row => row.id)).size;
  const uniqueKey = `unique-${uma?.unique_skill_id}`;
  const levels = [...new Set(rows.flatMap(row =>
    (row.screen === 'details-skills' || row.screen === 'finished-details') && row.resolution && row.resolution !== 'ignored_no_race_effect'
      && row.resolution.matched.id === uma?.unique_skill_id && row.fields.level !== null ? [row.fields.level] : []))];
  const uniqueLevel = edits[uniqueKey] ?? (levels.length === 1 ? String(levels[0]) : '');
  const reviewed = uma && uniqueLevel ? [
    ...observations.map(row => row.id === uma.unique_skill_id && row.owned ? { ...row, level: Number(uniqueLevel) } : row),
    ...(observations.some(row => row.id === uma.unique_skill_id && row.owned) ? [] :
      [{ id: uma.unique_skill_id, owned: true, level: Number(uniqueLevel), price: null, hint: null }]),
  ] : observations;
  const chains = catalog.screenshot_skills ? tierChains(reviewed, catalog.screenshot_skills) : [];
  const tooMany = purchasePlan(chains, [], 0).skills.length > 100;
  const unresolved = unknown.filter(row => resolved[row.key] === undefined);
  const invalidStat = stats.findIndex((_, i) => !validNumber(stat(i), 1, 2000));
  const invalidAptitude = aptitudes.flatMap(([key, , names]) => names.map((name, i) => ({ key, name, i })))
    .find(({ key, i }) => !aptitude(key, i));
  const block: ApplyBlock | undefined =
    mixed || cards.size > 1 ? { reason: 'Remove screenshots from the other Uma or career.', focus: 'remove' }
    : !numbers ? { reason: 'Capture a stats screen first.', focus: 'capture' }
    : !finished && !learn ? { reason: 'Capture the Learn screen first.', focus: 'scan' }
    : !uma ? { reason: 'Choose the Uma in the review.', focus: 'uma' }
    : !validNumber(uniqueLevel, 1, 6) ? { reason: 'Confirm the unique skill level.', focus: 'unique' }
    : invalidStat >= 0 ? { reason: `Check the ${stats[invalidStat]![1]} stat.`, focus: stats[invalidStat]![0] }
    : invalidAptitude ? { reason: `Confirm the ${invalidAptitude.name} aptitude.`, focus: `${invalidAptitude.key}-${invalidAptitude.i}` }
    : !finished && !validNumber(sp, 0, 65535) ? { reason: 'Confirm the Skill Points total.', focus: 'points' }
    : unresolved[0] ? { reason: unresolved.length === 1 ? 'Match the unknown skill.' : `Match ${unresolved.length} unknown skills.`, focus: unresolved[0].key }
    : tooMany ? { reason: 'Remove screenshots to stay within 100 owned skills.', focus: 'remove' }
    : undefined;
  const numSkills = new Set(reviewed.map(row => row.id)).size;
  const scannedSkills = scanGuide === 'finished' ? numSkills : scannedLearnSkills;
  const waitingViews = (scanGuide ? Math.max(queued - read, 0) : 0) + pending + Number(captureBusy);
  const applyLabel = importApplyLabel(finished || (!numbers && guide === 'finished'), !!numbers, numSkills, applyQueued ? waitingViews : undefined);
  const edit = (key: string, value: string) => setEdits(previous => ({ ...previous, [key]: value }));
  const review = (block: ApplyBlock) => {
    const target = dialog.current?.querySelector<HTMLElement>(`[data-import-focus="${block.focus}"]`);
    const control = target?.matches('button, input, select') ? target : target?.querySelector<HTMLElement>('button, input, select');
    control?.scrollIntoView({ block: 'nearest' });
    control?.focus({ preventScroll: true });
  };
  const applyBuild = () => {
    const grade = (key: typeof aptitudes[number][0], i: number) => grades.indexOf(aptitude(key, i)) + 1;
    onApply({
      umaCardId: cardId,
      stats: { speed: Number(stat(0)), stamina: Number(stat(1)), pow: Number(stat(2)), guts: Number(stat(3)), wiz: Number(stat(4)) },
      ground: [grade('track', 0), grade('track', 1)],
      distance: [grade('distance', 0), grade('distance', 1), grade('distance', 2), grade('distance', 3)],
      style: [grade('style', 0), grade('style', 1), grade('style', 2), grade('style', 3)],
    }, { points: finished ? null : Number(sp), observations: reviewed, ignored, selected: [] });
  };
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (applying.current) return;
    if (session.current || pending || captureBusy) {
      applying.current = true;
      setScanError(undefined);
      setApplyQueued(true);
      stopScan();
    } else if (block) {
      review(block);
    } else {
      applyBuild();
    }
  };
  useEffect(() => {
    if (!applyQueued || !applying.current || (!scanError && (scanGuide || pending || captureBusy))) return;
    applying.current = false;
    setApplyQueued(false);
    if (scanError) return;
    if (block) review(block);
    else applyBuild();
  });

  return <dialog ref={dialog} aria-labelledby="import-heading" className="screenshot-dialog desktop-tool panel"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPaste={event => {
      const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
      if (images.length) { event.preventDefault(); add(images); }
    }}>
    <form noValidate onSubmit={apply}>
      <header className="drawer-heading"><h2 id="import-heading">Import from screenshots</h2><button type="button" aria-label="Close import" onClick={onClose}>×</button></header>
      <div className="import-dialog-body build-body">
        <section className="import-guide" aria-label="Capture guide">
          <div className="seg import-guide-switch" role="group" aria-label="Import guide">{(Object.keys(importGuide) as ImportGuide[]).map(flow =>
            <button key={flow} type="button" aria-pressed={guide === flow} onClick={() => setGuideChoice(flow)}>{importGuide[flow].label}</button>)}</div>
          <ol className="import-steps">{importGuide[guide].steps.map((step, i) =>
            <li key={step} data-ready={guideSteps[i]} aria-current={i === currentStep ? 'step' : undefined}>
              <span className="import-step-number" aria-hidden="true">{guideSteps[i] ? '✓' : i + 1}</span>
              {guideSteps[i] && <span className="sr-only">Captured. </span>}
              <span>{step.split('**').map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : part)}</span>
            </li>)}</ol>
        </section>
        <div className="import-drop" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={event => { event.preventDefault(); add(Array.from(event.dataTransfer.files)); }}>
          <strong>Paste or drop screenshots</strong>
          <p>Use <kbd>Ctrl</kbd> + <kbd>V</kbd> or drop images in any order.</p>
          <div className="import-actions">
            <button type="button" onClick={() => {
              setPickerError(false);
              const picker = fileInput.current;
              if (!picker) return;
              try {
                if (typeof picker.showPicker === 'function') picker.showPicker();
                else picker.click();
              } catch { setPickerError(true); }
            }}>Choose images</button>
            <button type="button" data-import-focus="capture" onClick={() => void capture(true)} disabled={captureBusy}>
              {captureBusy ? 'Capturing…' : 'Capture game window'}
            </button>
            <button type="button" data-import-focus="scan" onClick={() => scanGuide ? stopScan() : startScan(guide)} disabled={stopping}>
              {stopping ? 'Stopping…' : scanGuide ? 'Stop' : 'Start scanning'}
            </button>
          </div>
          {hotkeyReady && <p className="import-shortcut"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>U</kbd> works while the game has focus.</p>}
          {hotkeyError && <small role="status" className="import-warning">{hotkeyError}</small>}
          {scanGuide && <p role="status" className="import-scanning">
            <strong>{scanGuide === 'finished' ? 'Skills' : 'Learn'} · {scannedSkills} {scannedSkills === 1 ? 'skill' : 'skills'} so far</strong>
          </p>}
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onError={() => setPickerError(true)} onChange={event => {
            add(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}/>
        </div>
        {pickerError && <p role="alert" className="import-warning">Couldn’t open the image picker. Paste or drop the screenshot instead.</p>}
        {captureError && <p role="alert" className="import-warning">{captureError}</p>}
        {scanError && <p role="alert" className="import-warning">{scanError}</p>}
        {pending > 0 && <p role="status">Reading {pending} {pending === 1 ? 'image' : 'images'}…</p>}
        {!!sources.length && <ul className="import-sources" aria-label="Scanned screenshots">{sources.map(({ id, scan, error }) =>
          <li key={id}><div><strong>{scan ? screens[scan.screen] : 'Image could not be read'}</strong>
            {(error || scan?.instruction) && <small>{error ?? scan?.instruction}</small>}
            {scan && skillScreens.has(scan.screen) && (scan.skills.length > 0
              ? <small>{scan.skills.length} {scan.skills.length === 1 ? 'skill row' : 'skill rows'}</small>
              : <small className="import-warning">No skills read on this screenshot. Make the game window larger or recapture.</small>)}
          </div><button type="button" data-import-focus="remove" aria-label={`Remove screenshot ${id + 1}`} onClick={() => setSources(previous => previous.filter(source => source.id !== id))}>×</button></li>
        )}</ul>}
        {(numbers || learn || rows.length > 0) && <div className="import-review">
          <section aria-label="Review build">
            <h3>Review build</h3>
            {cards.size > 1 && <p className="import-warning" role="alert">These Career screenshots show different Umas. Remove the screenshots from the other career.</p>}
            {mixed && <p className="import-warning" role="alert">Remove the in-career screenshots to load the finished Uma.</p>}
            <div data-import-focus="uma"><StaminaUmaPicker umas={catalog.umas} selected={uma} recent={recentUmas} full={false}
              onSelect={card => { if (card) onUmaPicked(card.card_id); setChosen(card?.card_id ?? 0); }}/></div>
            {uma && <div className="import-unique-level">
              <label>Unique skill level<select data-import-focus="unique" required value={uniqueLevel} onChange={event => edit(uniqueKey, event.target.value)}>
                <option value="">Check level</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>Lv {level}</option>)}
              </select></label>
              {!uniqueLevel && <small className="import-warning">Confirm the unique skill level or add a Details screenshot that shows it.</small>}
            </div>}
            <div className="raw-stats">{stats.map(([key, label], i) => <label key={key}>{label}<input data-import-focus={key} aria-label={label} type="number" min={1} max={2000} required value={stat(i)} onChange={event => edit(key, event.target.value)}/></label>)}</div>
            {aptitudes.map(([key, label, names]) => <div className="field" key={key}><span>{label}</span>
              <div className={`aptitude-grid aptitude-${key === 'track' ? 'ground' : key}`}>{names.map((name, i) =>
                <label key={name}>{name}<select data-import-focus={`${key}-${i}`} aria-label={`${name} aptitude`} required value={aptitude(key, i)} onChange={event => edit(`${key}-${i}`, event.target.value)}>
                  <option value="">—</option>{[...grades].map(grade => <option key={grade}>{grade}</option>)}
                </select></label>)}</div></div>)}
            {!finished && <><label className="import-points">Skill Points<input data-import-focus="points" type="number" min={0} max={65535} required value={sp} onChange={event => edit('points', event.target.value)}/></label>
              {points.length > 1 && <small className="import-warning">Learn screenshots show different totals. Enter the correct Skill Points.</small>}</>}
          </section>
          {(unknown.length > 0 || ignored.length > 0) && <section aria-label="Review skill matches">
            {unknown.length > 0 && <><h3>Unmatched skills</h3><p className="muted">Confirm every row before applying.</p>
              {unknown.some(row => row.screen === 'finished-details' && row.smallPanel && resolved[row.key] === undefined) &&
                <p className="import-warning">For finished Umas, a larger game window reads skill names more reliably.</p>}
              {suggestions.length > 0 && <button type="button" onClick={() => setResolved(previous => ({ ...Object.fromEntries(suggestions), ...previous }))}>Accept suggestions</button>}
              {unknown.map(({ key, raw_name: raw, variant_choice: variant }) => <div className="import-unmatched" key={key} data-import-focus={key}>
                {variant ? <><span>{variant.name}</span>
                  <div className="import-variants" role="group" aria-label={`${variant.name} variant`}>
                    {([[variant.circle, '○'], [variant.double_circle, '◎']] as const).map(([id, symbol]) =>
                      <button type="button" key={id} aria-label={`${variant.name} ${symbol}`} aria-pressed={resolved[key] === id}
                        onClick={() => resolve(key, id)}>{symbol}{variant.suggested === id && <small>Suggested</small>}</button>)}
                  </div></> : <><span>{raw || 'Unreadable skill name'}</span>
                  <SkillPicker resolving catalog={catalog} skills={resolved[key] === undefined ? [] : [{ id: resolved[key]!, level: 1 }]} limit={1}
                    recent={recent} onRecent={onRecent} onChange={value => resolve(key, value[0]?.id)}/></>}
              </div>)}</>}
            {ignored.length > 0 && <><h3>Ignored · No race effect</h3><ul className="import-ignored">{ignored.map(name => <li key={name}>{name}</li>)}</ul></>}
          </section>}
        </div>}
        {tooMany && <p role="alert" className="import-warning">The screenshots contain more than 100 owned skills. Remove screenshots to stay within the simulator’s limit.</p>}
      </div>
      <footer className="import-footer">
        {!applyQueued && block && <p className="import-warning" role="status">{block.reason}</p>}
        <button type="submit" className="import-apply" aria-live="polite">{applyLabel}</button>
      </footer>
      {captureToast && <div className="import-toast" role="status">Game screenshot added</div>}
    </form>
  </dialog>;
}
