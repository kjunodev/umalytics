import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SkillPicker } from './SkillPicker';
import { StaminaUmaPicker } from './StaminaUmaPicker';
import { purchasePlan, tierChains, type Observation, type Screen, type Screenshot, type ScreenshotImport } from './staminaScreenshot';
import type { Catalog, StaminaEditorBuild } from './staminaTypes';

const screens: Record<Screen, string> = {
  'attributes-numbers': 'Career Attributes · Number view',
  'attributes-chart': 'Career Attributes · Chart view',
  'career-skills': 'Career Skills',
  'details-skills': 'Uma Details · Skills',
  learn: 'Learn',
  unsupported: 'Unsupported screenshot',
};
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

export function StaminaScreenshotImport({ catalog, recent, onRecent, onClose, onApply }: {
  catalog: Catalog;
  recent: number[];
  onRecent: (ids: number[]) => void;
  onClose: () => void;
  onApply: (build: Pick<StaminaEditorBuild, 'umaCardId' | 'stats' | 'ground' | 'distance' | 'style'>, scan: ScreenshotImport) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const queue = useRef(Promise.resolve());
  const closed = useRef(false);
  const [pending, setPending] = useState(0);
  const [sources, setSources] = useState<Source[]>([]);
  const [chosen, setChosen] = useState<number>();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<Record<string, number | undefined>>({});
  useEffect(() => {
    const element = dialog.current;
    closed.current = false;
    element?.showModal();
    return () => { closed.current = true; element?.close(); };
  }, []);

  const add = (files: File[]) => {
    if (!files.length) return;
    setPending(count => count + files.length);
    for (const file of files) {
      const id = nextId.current++;
      queue.current = queue.current.then(async () => {
        if (closed.current) return;
        try {
          const scan = await scanImage(file);
          if (!closed.current) setSources(previous => [...previous, { id, scan }]);
        } catch (error) {
          if (!closed.current) setSources(previous => [...previous, { id, error: error instanceof Error ? error.message : String(error) }]);
        } finally { if (!closed.current) setPending(count => count - 1); }
      });
    }
  };
  const numbers = [...sources].reverse().find(source => source.scan?.screen === 'attributes-numbers')?.scan;
  const skills = sources.some(source => source.scan?.screen === 'career-skills' || source.scan?.screen === 'details-skills');
  const learn = sources.some(source => source.scan?.screen === 'learn');
  const points = [...new Set(sources.flatMap(({ scan }) => scan?.skill_points == null ? [] : [scan.skill_points]))];
  const cards = new Set(sources.flatMap(({ scan }) =>
    scan?.card && (scan.screen === 'attributes-numbers' || scan.screen === 'career-skills') ? [scan.card.id] : []));
  const cardId = chosen ?? numbers?.card?.id ?? (cards.size === 1 ? [...cards][0] : undefined);
  const uma = catalog.umas.find(card => card.card_id === cardId);
  const rows = sources.flatMap(({ id, scan }) => scan?.skills.map((row, index) => ({
    ...row, key: `${id}-${index}`, owned: scan.screen !== 'learn' || row.fields.obtained === true,
  })) ?? []);
  const canSimulate = (id: number) => Object.hasOwn(catalog.screenshot_skills ?? {}, id);
  const ignored = [...new Set(rows.flatMap(row => {
    if (row.resolution === 'ignored_no_race_effect') return [row.raw_name];
    const id = resolved[row.key];
    return id !== undefined && !canSimulate(id) ? [catalog.skills.find(skill => skill.id === id)?.name ?? row.raw_name] : [];
  }))];
  const unknown = rows.filter(row => row.resolution === null);
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
    return [{ id, owned: row.owned, level: row.fields.level, price: row.fields.cost, hint: row.fields.hint, hintUnreadable: row.fields.hint_unreadable }];
  });
  if (uma && !observations.some(row => row.id === uma.unique_skill_id && row.owned && row.level !== null)) {
    // The Career Skills tab omits the unique level.
    observations.push({ id: uma.unique_skill_id, owned: true, level: 4, price: null, hint: null });
  }
  const chains = catalog.screenshot_skills ? tierChains(observations, catalog.screenshot_skills) : [];
  const tooMany = purchasePlan(chains, [], 0).skills.length > 100;
  const unresolved = unknown.filter(row => resolved[row.key] === undefined).length;
  const canApply = !!(numbers && skills && learn && uma && !pending && cards.size <= 1 && !unresolved && !tooMany);
  const edit = (key: string, value: string) => setEdits(previous => ({ ...previous, [key]: value }));
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canApply) return;
    const grade = (key: typeof aptitudes[number][0], i: number) => grades.indexOf(aptitude(key, i)) + 1;
    onApply({
      umaCardId: cardId,
      stats: { speed: Number(stat(0)), stamina: Number(stat(1)), pow: Number(stat(2)), guts: Number(stat(3)), wiz: Number(stat(4)) },
      ground: [grade('track', 0), grade('track', 1)],
      distance: [grade('distance', 0), grade('distance', 1), grade('distance', 2), grade('distance', 3)],
      style: [grade('style', 0), grade('style', 1), grade('style', 2), grade('style', 3)],
    }, { points: Number(sp), observations, ignored, selected: [] });
  };

  return <dialog ref={dialog} aria-labelledby="import-heading" className="screenshot-dialog desktop-tool panel"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPaste={event => {
      const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
      if (images.length) { event.preventDefault(); add(images); }
    }}>
    <form onSubmit={apply}>
      <header className="drawer-heading"><h2 id="import-heading">Import from screenshots</h2><button type="button" aria-label="Close import" onClick={onClose}>×</button></header>
      <div className="import-dialog-body build-body">
        <div className="import-drop" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={event => { event.preventDefault(); add(Array.from(event.dataTransfer.files)); }}>
          <strong>Paste or drop screenshots</strong>
          <p>Use <kbd>Ctrl</kbd> + <kbd>V</kbd> or drop images in any order.</p>
          <button type="button" onClick={() => fileInput.current?.click()}>Choose images</button>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={event => {
            add(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}/>
        </div>
        <ul className="import-checklist" aria-label="Screens needed">
          <li data-ready={!!numbers}>Complete Career Attributes · Number view</li>
          <li data-ready={skills}>Complete Career Skills · Scroll to capture all rows</li>
          <li data-ready={learn}>Learn · Capture overlapping screenshots</li>
        </ul>
        {pending > 0 && <p role="status">Reading {pending} {pending === 1 ? 'image' : 'images'}…</p>}
        {!!sources.length && <ul className="import-sources" aria-label="Scanned screenshots">{sources.map(({ id, scan, error }) =>
          <li key={id}><div><strong>{scan ? screens[scan.screen] : 'Image could not be read'}</strong>
            {(error || scan?.instruction) && <small>{error ?? scan?.instruction}</small>}
            {!!scan?.skills.length && <small>{scan.skills.length} {scan.skills.length === 1 ? 'skill row' : 'skill rows'}</small>}
          </div><button type="button" aria-label={`Remove screenshot ${id + 1}`} onClick={() => setSources(previous => previous.filter(source => source.id !== id))}>×</button></li>
        )}</ul>}
        {(numbers || learn || skills) && <div className="import-review">
          <section aria-label="Review build">
            <h3>Review build</h3>
            {cards.size > 1 && <p className="import-warning" role="alert">These Career screenshots show different Umas. Remove the screenshots from the other career.</p>}
            <StaminaUmaPicker umas={catalog.umas} selected={uma} uniques={[]} full={false} onSelect={card => setChosen(card?.card_id ?? 0)} onLevel={() => {}}/>
            <div className="raw-stats">{stats.map(([key, label], i) => <label key={key}>{label}<input aria-label={label} type="number" min={1} max={2000} required value={stat(i)} onChange={event => edit(key, event.target.value)}/></label>)}</div>
            {aptitudes.map(([key, label, names]) => <div className="field" key={key}><span>{label}</span>
              <div className={`aptitude-grid aptitude-${key === 'track' ? 'ground' : key}`}>{names.map((name, i) =>
                <label key={name}>{name}<select aria-label={`${name} aptitude`} required value={aptitude(key, i)} onChange={event => edit(`${key}-${i}`, event.target.value)}>
                  <option value="">—</option>{[...grades].map(grade => <option key={grade}>{grade}</option>)}
                </select></label>)}</div></div>)}
            <label className="import-points">Skill Points<input type="number" min={0} max={65535} required value={sp} onChange={event => edit('points', event.target.value)}/></label>
            {points.length > 1 && <small className="import-warning">Learn screenshots show different totals. Enter the correct Skill Points.</small>}
          </section>
          {(unknown.length > 0 || ignored.length > 0) && <section aria-label="Review skill matches">
            {unknown.length > 0 && <><h3>Unmatched skills</h3><p className="muted">Choose a skill for every row before applying.</p>
              {unknown.map(row => <div className="import-unmatched" key={row.key}><span>{row.raw_name || 'Unreadable skill name'}</span>
                <SkillPicker resolving catalog={catalog} skills={resolved[row.key] === undefined ? [] : [{ id: resolved[row.key]!, level: 1 }]} limit={1}
                  recent={recent} onRecent={onRecent} onChange={value => setResolved(previous => ({ ...previous, [row.key]: value[0]?.id }))}/>
              </div>)}</>}
            {ignored.length > 0 && <><h3>Ignored · No race effect</h3><ul className="import-ignored">{ignored.map(name => <li key={name}>{name}</li>)}</ul></>}
          </section>}
        </div>}
        {tooMany && <p role="alert" className="import-warning">The screenshots contain more than 100 owned skills. Remove screenshots to stay within the simulator’s limit.</p>}
      </div>
      <footer className="drawer-footer">
        <span className="muted">{numbers && skills && learn ? 'Applying replaces the current build’s stats, aptitudes and skills.' : 'Add each screen to apply the import.'}</span>
        <button type="submit" className="import-apply" disabled={!canApply}>Apply to build</button>
      </footer>
    </form>
  </dialog>;
}
