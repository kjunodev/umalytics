import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { fuzzyScore } from './staminaState';
import type { Catalog, CatalogSkill, StaminaBuild } from './staminaTypes';

export function SkillIcon({ skill }: { skill: CatalogSkill | undefined }) {
  const [failed, setFailed] = useState(false);
  return skill?.icon_path && !failed ? <img className="skill-icon" alt="" loading="lazy" decoding="async" src={convertFileSrc(skill.icon_path)} onError={() => setFailed(true)}/> : <span className="skill-icon skill-icon-fallback" aria-hidden="true">◇</span>;
}
export function SkillPicker({ catalog, skills, onChange, recent, onRecent, limit }: {
  catalog: Catalog; skills: StaminaBuild['skills']; onChange: (skills: StaminaBuild['skills']) => void;
  recent: number[]; onRecent: (recent: number[]) => void; limit: number;
}) {
  const listId = useId();
  const [adding, setAdding] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const typeahead = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (adding) typeahead.current?.scrollIntoView({ block: 'nearest' }); }, [adding, query]);
  const matches = useMemo(() => catalog.skills.filter(s => s.rarity !== 'unique' && !skills.some(selected => selected.id === s.id))
    .map(skill => ({ skill, score: fuzzyScore(`${skill.name} ${skill.id}`, query), recent: recent.includes(skill.id) ? recent.indexOf(skill.id) : 100 }))
    .filter(s => Number.isFinite(s.score)).sort((a, b) => a.recent - b.recent || a.score - b.score || a.skill.name.localeCompare(b.skill.name)), [catalog, skills, query, recent]);
  const selected = Math.min(active, Math.max(0, matches.length - 1));
  const add = (skill: CatalogSkill) => {
    if (skills.length >= limit) return;
    onChange([...skills, { id: skill.id, level: 1 }]); onRecent([skill.id, ...recent.filter(id => id !== skill.id)].slice(0, 30));
    setAdding(false); setQuery(''); setActive(0); requestAnimationFrame(() => addButton.current?.focus());
  };
  return <div className="skill-picker">
    <div className="skill-chips">{skills.map(skill => {
      const meta = catalog.skills.find(s => s.id === skill.id);
      return <span className={`skill-chip rarity-${meta?.rarity ?? 'white'}`} key={skill.id}><SkillIcon skill={meta}/><span>{meta?.name ?? `Skill ${skill.id}`}</span>
        <button type="button" aria-label={`Remove skill ${skill.id}`} onClick={() => onChange(skills.filter(s => s.id !== skill.id))}>×</button></span>;
    })}
    {!adding ? <button ref={addButton} type="button" className="add-skill" disabled={skills.length >= limit} onClick={() => setAdding(true)}>+ Add skill</button> : <div className="skill-typeahead" ref={typeahead}>
      <input autoFocus role="combobox" aria-label="Search skills" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={matches.length ? `${listId}-${selected}` : undefined} value={query} placeholder="Type a skill name…" onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); requestAnimationFrame(() => addButton.current?.focus()); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const next = (selected + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % Math.max(1, matches.length); setActive(next); document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' }); }
        if (e.key === 'Enter') { e.preventDefault(); if (matches[selected]) add(matches[selected].skill); }
      }}/>
      <div className="skill-options" id={listId} role="listbox" aria-label="Matching skills">{matches.map(({ skill }, i) => <button type="button" role="option" id={`${listId}-${i}`} aria-selected={selected === i} className={`rarity-${skill.rarity}`} key={skill.id} onClick={() => add(skill)}><SkillIcon skill={skill}/><span>{skill.name}</span>{recent.includes(skill.id) && <small>Recent</small>}</button>)}{!matches.length && <p role="status">No matching skills.</p>}</div>
    </div>}
    </div>
  </div>;
}
