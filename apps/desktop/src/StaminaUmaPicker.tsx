import { useId, useRef, useState } from 'react';
import { UmaImage, getFallbackUmaImageUrl } from '@umalytics/ui/common/UmaImage';
import { SkillIcon } from './SkillPicker';
import { fuzzyScore } from './staminaState';
import type { CatalogSkill, CatalogUma, StaminaBuild } from './staminaTypes';

function UmaLabel({ uma, placeholder = 'No Uma' }: { uma?: CatalogUma; placeholder?: string }) {
  return <>
    {uma && <span className="stamina-uma-portrait" aria-hidden="true"><UmaImage imageUrl={getFallbackUmaImageUrl(String(uma.card_id))} name={uma.name}/></span>}
    <span className="stamina-uma-name">{uma ? `${uma.name} ${uma.title}` : placeholder}</span>
  </>;
}

export function StaminaUmaPicker({ umas, selected, uniques, full, onSelect, onAptitudes, onLevel }: {
  umas: CatalogUma[];
  selected: CatalogUma | undefined;
  uniques: { skill: StaminaBuild['skills'][number]; meta: CatalogSkill }[];
  full: boolean;
  onSelect: (uma: CatalogUma | undefined) => void;
  onAptitudes: (aptitudes: CatalogUma['aptitudes']) => void;
  onLevel: (id: number, level: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const matches = full ? [] : umas.map(uma => ({ uma, score: fuzzyScore(`${uma.name} ${uma.title} ${uma.card_id}`, query) }))
    .filter(({ score }) => Number.isFinite(score)).sort((a, b) => a.score - b.score).map(({ uma }) => uma);
  const options = Number.isFinite(fuzzyScore('No Uma', query)) ? [undefined, ...matches] : matches;
  const index = Math.min(active, Math.max(0, options.length - 1));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (uma: CatalogUma | undefined) => { onSelect(uma); close(); };

  return <div className="field stamina-uma-field" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span>Uma</span>
    <div className="stamina-uma-actions">
      <button type="button" className="stamina-uma-trigger" ref={trigger} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => { setQuery(''); setActive(0); setOpen(!open); }}>
        <UmaLabel uma={selected} placeholder={uniques.length ? 'Choose Uma' : 'No Uma'}/><span className="stamina-uma-chevron" aria-hidden="true">▾</span>
      </button>
      <button type="button" className="stamina-uma-aptitudes" disabled={!selected} onClick={() => { if (selected) onAptitudes(selected.aptitudes); }}>Use base aptitudes</button>
    </div>
    {open && <div className="skill-typeahead stamina-uma-typeahead">
      <input autoFocus role="combobox" aria-label="Search Umas" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={options.length ? `${listId}-${index}` : undefined} placeholder="Search by name or title…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
          event.preventDefault();
          const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
          setActive(next);
          document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
        }
        if (event.key === 'Enter' && options.length) { event.preventDefault(); choose(options[index]); }
      }}/>
      <div className="skill-options stamina-uma-options" id={listId} role="listbox" aria-label="Matching Umas">
        {options.map((uma, i) => <button type="button" role="option" key={uma?.card_id ?? 'none'} id={`${listId}-${i}`} aria-selected={i === index} tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(uma)}><UmaLabel uma={uma}/></button>)}
        {full ? <p role="status">Remove a skill to choose an Uma.</p> : !options.length && <p role="status">No matching Umas.</p>}
      </div>
    </div>}
    {uniques.map(({ skill, meta }) => <div className="skill-chips" key={skill.id}><span className="skill-chip rarity-unique"><SkillIcon skill={meta}/><span>{meta.name}</span>
      <label className="skill-level">Lv<select aria-label={`${meta.name} level`} value={skill.level} onChange={event => onLevel(skill.id, Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(level => <option key={level}>{level}</option>)}</select></label>
    </span></div>)}
  </div>;
}
