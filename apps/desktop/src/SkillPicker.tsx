import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { hpEffectTitle, hpPercent } from './staminaShop';
import { fuzzyScore } from './staminaState';
import { displaySkillName, type Catalog, type CatalogSkill, type HpEffect, type StaminaBuild } from './staminaTypes';

export function SkillIcon({ skill }: { skill: CatalogSkill | undefined }) {
  const [failed, setFailed] = useState(false);
  return skill?.icon_path && !failed ? <img className="skill-icon" alt="" loading="lazy" decoding="async" src={convertFileSrc(skill.icon_path)} onError={() => setFailed(true)}/> : <span className="skill-icon skill-icon-fallback" aria-hidden="true">◇</span>;
}

export function HpAmounts({ effects }: { effects: HpEffect[] }) {
  return <span className="hp-amounts">{effects.map((effect, index) =>
    <span key={index} title={hpEffectTitle(effect)} aria-label={hpEffectTitle(effect)}>{hpPercent(effect.value)}</span>)}</span>;
}

function SkillHpNote({ catalog, id }: { catalog: Catalog; id: number }) {
  const effects = catalog.hp_effects?.[id];
  return effects?.length ? <>
    {effects.some(effect => effect.value < 0) && <small className="import-warning">Drain</small>}
    <HpAmounts effects={effects}/>
  </> : null;
}

export function SkillPicker({ catalog, skills, onChange, recent, onRecent, limit, resolving = false, showSelected = true, addLabel }: {
  catalog: Catalog; skills: StaminaBuild['skills']; onChange: (skills: StaminaBuild['skills']) => void;
  recent: number[]; onRecent: (recent: number[]) => void; limit: number; resolving?: boolean; showSelected?: boolean; addLabel?: string;
}) {
  const listId = useId();
  const [adding, setAdding] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const typeahead = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (adding) typeahead.current?.scrollIntoView({ block: 'nearest' }); }, [adding, query]);
  const close = useCallback((restoreFocus: boolean) => {
    setAdding(false); setQuery(''); setActive(0);
    if (restoreFocus) requestAnimationFrame(() => addButton.current?.focus());
  }, []);
  useEffect(() => {
    if (!adding) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !typeahead.current?.contains(event.target)) close(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [adding, close]);
  const matches = useMemo(() => catalog.skills.filter(s => (resolving ? s.name !== `Skill ${s.id}` : s.rarity !== 'unique') && !skills.some(selected => selected.id === s.id))
    .map(skill => ({ skill, name: displaySkillName(skill.name), score: fuzzyScore(`${skill.name} ${skill.id}`, query), recent: recent.includes(skill.id) ? recent.indexOf(skill.id) : 100 }))
    .filter(s => Number.isFinite(s.score)).sort((a, b) => a.recent - b.recent || a.score - b.score || a.name.localeCompare(b.name)), [catalog, skills, query, recent, resolving]);
  const ordinaryNames = new Set(matches.filter(({ skill }) => skill.rarity !== 'unique').map(({ name }) => name));
  const selected = Math.min(active, Math.max(0, matches.length - 1));
  const add = (skill: CatalogSkill) => {
    if (skills.length >= limit) return;
    onChange([...skills, { id: skill.id, level: 1 }]); onRecent([skill.id, ...recent.filter(id => id !== skill.id)].slice(0, 30));
    close(true);
  };
  return <div className="skill-picker">
    <div className="skill-chips">{showSelected && skills.map(skill => {
      const meta = catalog.skills.find(s => s.id === skill.id);
      return <span className={`skill-chip rarity-${meta?.rarity ?? 'white'}`} key={skill.id}><SkillIcon skill={meta}/><span>{displaySkillName(meta?.name ?? `Skill ${skill.id}`)}</span>
        <SkillHpNote catalog={catalog} id={skill.id}/>
        <button type="button" aria-label={`Remove skill ${skill.id}`} onClick={() => onChange(skills.filter(s => s.id !== skill.id))}>×</button></span>;
    })}
    {!adding ? <button ref={addButton} type="button" className="add-skill" disabled={skills.length >= limit} onClick={() => setAdding(true)}>{addLabel ?? (resolving ? 'Match skill' : '+ Add skill')}</button> : <div className="skill-typeahead" ref={typeahead} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    }}>
      <div className="skill-typeahead-search">
        <input autoFocus role="combobox" aria-label="Search skills" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={matches.length ? `${listId}-${selected}` : undefined} value={query} placeholder="Type a skill name…" onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const next = (selected + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % Math.max(1, matches.length); setActive(next); document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' }); }
          if (e.key === 'Enter') { e.preventDefault(); if (matches[selected]) add(matches[selected].skill); }
        }}/>
        <button type="button" onClick={() => close(true)}>Cancel</button>
      </div>
      <div className="skill-options" id={listId} role="listbox" aria-label="Matching skills">{matches.map(({ skill, name }, i) => {
        const sameNameAsOrdinary = skill.rarity === 'unique' && ordinaryNames.has(name);
        return <button type="button" role="option" id={`${listId}-${i}`} aria-label={sameNameAsOrdinary ? `${name}, unique skill` : name} aria-describedby={catalog.hp_effects?.[skill.id]?.length ? `${listId}-hp-${i}` : undefined} aria-selected={selected === i} className={`rarity-${skill.rarity}`} key={skill.id} onClick={() => add(skill)}>
          <SkillIcon skill={skill}/><span>{name}</span>{sameNameAsOrdinary && <small>Unique</small>}{recent.includes(skill.id) && <small>Recent</small>}
          {catalog.hp_effects?.[skill.id]?.length ? <span id={`${listId}-hp-${i}`}><SkillHpNote catalog={catalog} id={skill.id}/></span> : null}
        </button>;
      })}{!matches.length && <p role="status">No matching skills.</p>}</div>
    </div>}
    </div>
  </div>;
}
