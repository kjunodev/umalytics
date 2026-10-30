import { useState } from 'react';
import { SkillPicker } from './SkillPicker';
import { ballparkBuild, ballparkDefaults, defaultKits, roles, type PresetMemory, type Role } from './staminaPresetState';
import { roleNames, strategy, type Catalog, type StaminaBuild } from './staminaTypes';

export function StaminaPresets({ catalog, memory, onChange, build, onLoad, recent, onRecent }: {
  catalog: Catalog; memory: PresetMemory; onChange: (value: PresetMemory) => void; build: StaminaBuild; onLoad: (build: StaminaBuild) => void;
  recent: number[]; onRecent: (ids: number[]) => void;
}) {
  const [name, setName] = useState(''), [editing, setEditing] = useState<Role>(), [renaming, setRenaming] = useState<string>(), [rename, setRename] = useState(''), [deleting, setDeleting] = useState<string>();
  const update = (defaults: StaminaBuild) => onChange({ ...memory, defaults });
  return <div className="presets-content">
    <section aria-label="Ballpark builds"><h3>Ballpark builds</h3><p className="muted">Loads defaults and the role kit. Keeps your stamina; your unique starts empty.</p>
      <div className="ballpark-actions">{roles.map((role, i) => <button type="button" key={role} onClick={() => onLoad(ballparkBuild(role, memory, build))}>Ballpark {roleNames[i]}</button>)}</div>
    </section>
    <section aria-label="Saved builds"><h3>Saved builds</h3><form className="preset-save" onSubmit={e => { e.preventDefault(); if (!name.trim() || memory.builds.length >= 100) return; onChange({ ...memory, builds: [...memory.builds, { id: crypto.randomUUID(), name: name.trim(), build: structuredClone(build) }] }); setName(''); }}>
      <label>Preset name<input aria-label="Preset name" required maxLength={80} value={name} onChange={e => setName(e.target.value)}/></label><button type="submit" disabled={!name.trim() || memory.builds.length >= 100}>Save current build</button>
    </form>
    {!memory.builds.length && <p className="muted">No saved builds yet.</p>}
    {memory.builds.map(preset => <div className="saved-build" key={preset.id}>
      <strong>{preset.name}</strong><small className="muted">{roleNames[strategy(preset.build) - 1]} · {Object.values(preset.build.stats).join('/')} · {preset.build.skills.length} skills</small>
      <div className="preset-actions"><button type="button" onClick={() => onLoad(structuredClone(preset.build))}>Load {preset.name}</button>
        <button type="button" onClick={() => { setRenaming(preset.id); setRename(preset.name); }}>Rename</button>
        <button type="button" disabled={memory.builds.length >= 100} onClick={() => onChange({ ...memory, builds: [...memory.builds, { ...structuredClone(preset), id: crypto.randomUUID(), name: `${preset.name.slice(0, 73)} (copy)` }] })}>Duplicate</button>
        <button type="button" onClick={() => setDeleting(preset.id)}>Delete</button></div>
      {renaming === preset.id && <form className="preset-save" onSubmit={e => { e.preventDefault(); if (!rename.trim()) return; onChange({ ...memory, builds: memory.builds.map(p => p.id === preset.id ? { ...p, name: rename.trim() } : p) }); setRenaming(undefined); }}><input aria-label="New preset name" autoFocus required maxLength={80} value={rename} onChange={e => setRename(e.target.value)}/><button type="submit">Save name</button><button type="button" onClick={() => setRenaming(undefined)}>Cancel rename</button></form>}
      {deleting === preset.id && <div className="delete-confirm" role="alert"><p>Delete “{preset.name}”?</p><button type="button" onClick={() => { onChange({ ...memory, builds: memory.builds.filter(p => p.id !== preset.id) }); setDeleting(undefined); }}>Confirm delete</button><button type="button" onClick={() => setDeleting(undefined)}>Keep preset</button></div>}
    </div>)}
    </section>
    <section aria-label="Role kits"><h3>Role kits</h3><div className="ballpark-actions">{roles.map((role, i) => <button type="button" key={role} aria-pressed={editing === role} onClick={() => setEditing(editing === role ? undefined : role)}>Edit {roleNames[i]} kit</button>)}</div>
      {editing && <div className="kit-editor" aria-label={`${editing} kit editor`}><h4>{roleNames[roles.indexOf(editing)]} kit</h4>
        <SkillPicker catalog={catalog} kind="ordinary" limit={editing === 'runaway' ? 99 : 100} skills={(memory.kits[editing] ?? defaultKits[editing]).map(id => ({ id, level: 1 }))} onChange={skills => onChange({ ...memory, kits: { ...memory.kits, [editing]: skills.map(s => s.id) } })} recent={recent} onRecent={onRecent}/>
        <button type="button" onClick={() => { const kits = { ...memory.kits }; delete kits[editing]; onChange({ ...memory, kits }); }}>Reset {roleNames[roles.indexOf(editing)]} kit to default</button>
      </div>}
      <small className="muted kit-source">{defaultKits.source}</small>
    </section>
    <details className="ballpark-defaults"><summary>Ballpark defaults</summary><p className="muted">Stamina is kept from the current build.</p><div className="defaults-stats">{(['speed', 'pow', 'guts', 'wiz'] as const).map(key => <label key={key}>{({ speed: 'Speed', pow: 'Power', guts: 'Guts', wiz: 'Wit' })[key]}<input aria-label={`Default ${key}`} type="number" min={1} max={2000} required value={memory.defaults.stats[key]} onChange={e => update({ ...memory.defaults, stats: { ...memory.defaults.stats, [key]: Number(e.target.value) } })}/></label>)}</div>
      <label>Mood<select aria-label="Default mood" value={memory.defaults.motivation} onChange={e => update({ ...memory.defaults, motivation: Number(e.target.value) })}>{['Awful', 'Bad', 'Normal', 'Good', 'Great'].map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>
      {(['distance', 'style', 'ground'] as const).map(group => <div className={`aptitude-grid aptitude-${group}`} key={group}>{({ distance: ['Sprint', 'Mile', 'Medium', 'Long'], style: roleNames.slice(0, 4), ground: ['Turf', 'Dirt'] })[group].map((label, i) => <label key={label}>{label}<select aria-label={`Default ${label} aptitude`} value={memory.defaults[group][i]} onChange={e => { const values = [...memory.defaults[group]]; values[i] = Number(e.target.value); update({ ...memory.defaults, [group]: values }); }}>{['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'].map((grade, j) => <option key={grade} value={j + 1}>{grade}</option>)}</select></label>)}</div>)}
      <button type="button" onClick={() => update(structuredClone(ballparkDefaults))}>Reset ballpark defaults</button>
    </details>
  </div>;
}
