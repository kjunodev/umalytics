import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { fuzzyScore } from './staminaState';
import type { Catalog, CatalogSkill, StaminaBuild } from './staminaTypes';

function SkillIcon({ skill }: { skill: CatalogSkill | undefined }) {
  const [failed, setFailed] = useState(false);
  return skill?.icon_path && !failed ? <img className="skill-icon" alt="" loading="lazy" decoding="async" src={convertFileSrc(skill.icon_path)} onError={() => setFailed(true)}/> : <span className="skill-icon skill-icon-fallback" aria-hidden="true">◇</span>;
}
export function SkillPicker({ catalog, skills, onChange, recent, onRecent, showAll, onShowAll }: {
  catalog: Catalog; skills: StaminaBuild['skills']; onChange: (skills: StaminaBuild['skills']) => void;
  recent: number[]; onRecent: (recent: number[]) => void; showAll: boolean; onShowAll: (all: boolean) => void;
}) {
  const [adding, setAdding] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const typeahead = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (adding) typeahead.current?.scrollIntoView({ block: 'nearest' }); }, [adding, query, showAll]);
  const matches = useMemo(() => catalog.skills.filter(s => (showAll || s.global) && !skills.some(selected => selected.id === s.id))
    .map(skill => ({ skill, score: fuzzyScore(`${skill.name} ${skill.id}`, query), recent: recent.includes(skill.id) ? recent.indexOf(skill.id) : 100 }))
    .filter(s => Number.isFinite(s.score)).sort((a, b) => a.recent - b.recent || a.score - b.score || a.skill.name.localeCompare(b.skill.name)), [catalog, skills, query, recent, showAll]);
  const selected = Math.min(active, Math.max(0, matches.length - 1));
  const add = (skill: CatalogSkill) => {
    if (skills.length >= 100) return;
    onChange([...skills, { id: skill.id, level: 1 }]); onRecent([skill.id, ...recent.filter(id => id !== skill.id)].slice(0, 30));
    setAdding(false); setQuery(''); setActive(0); requestAnimationFrame(() => addButton.current?.focus());
  };
  return <div className="skill-picker">
    <label className="toggle-row"><input type="checkbox" checked={showAll} onChange={e => { onShowAll(e.target.checked); setActive(0); }}/>Show all regions{!catalog.local_skill_data && <small className="muted"> · engine catalog</small>}</label>
    <div className="skill-chips">{skills.map(skill => {
      const meta = catalog.skills.find(s => s.id === skill.id);
      return <span className={`skill-chip rarity-${meta?.rarity ?? 'white'}`} key={skill.id}><SkillIcon skill={meta}/><span>{meta?.name ?? `Skill ${skill.id}`}</span>
        {meta?.rarity === 'unique' && <label className="skill-level">Lv<select aria-label={`${meta.name} level`} value={skill.level} onChange={e => onChange(skills.map(s => s.id === skill.id ? { ...s, level: Number(e.target.value) } : s))}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}</select></label>}
        <button type="button" aria-label={`Remove skill ${skill.id}`} onClick={() => onChange(skills.filter(s => s.id !== skill.id))}>×</button></span>;
    })}
    {!adding ? <button ref={addButton} type="button" className="add-skill" disabled={skills.length >= 100} onClick={() => setAdding(true)}>+ Add skill</button> : <div className="skill-typeahead" ref={typeahead}>
      <input autoFocus role="combobox" aria-label="Search skills" aria-autocomplete="list" aria-expanded="true" aria-controls="skill-options" aria-activedescendant={matches.length ? `skill-option-${selected}` : undefined} value={query} placeholder="Type a skill name…" onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); requestAnimationFrame(() => addButton.current?.focus()); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const next = (selected + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % Math.max(1, matches.length); setActive(next); document.getElementById(`skill-option-${next}`)?.scrollIntoView({ block: 'nearest' }); }
        if (e.key === 'Enter') { e.preventDefault(); if (matches[selected]) add(matches[selected].skill); }
      }}/>
      <div className="skill-options" id="skill-options" role="listbox" aria-label="Matching skills">{matches.map(({ skill }, i) => <button type="button" role="option" id={`skill-option-${i}`} aria-selected={selected === i} className={`rarity-${skill.rarity}`} key={skill.id} onClick={() => add(skill)}><SkillIcon skill={skill}/><span>{skill.name}</span>{recent.includes(skill.id) && <small>Recent</small>}</button>)}{!matches.length && <p role="status">No matching skills.</p>}</div>
    </div>}
    </div>
  </div>;
}
