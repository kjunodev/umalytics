import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UmaImage, getFallbackUmaImageUrl } from '@umalytics/ui/common/UmaImage';
import { fuzzyScore } from './staminaState';
import type { CatalogUma } from './staminaTypes';

function Portrait({ uma }: { uma: CatalogUma }) {
  return <span className="stamina-uma-portrait" aria-hidden="true"><UmaImage imageUrl={getFallbackUmaImageUrl(String(uma.card_id))} name={uma.name}/></span>;
}

function UmaDialog({ umas, recent, selected, full, onClose, onPick }: {
  umas: CatalogUma[];
  recent: number[];
  selected?: CatalogUma;
  full: boolean;
  onClose: () => void;
  onPick: (uma: CatalogUma | undefined) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const title = useId();
  const [query, setQuery] = useState('');
  const searching = !!query.trim();
  const matches = useMemo(() => full ? [] : umas.map(uma => ({ uma, score: fuzzyScore(`${uma.name} ${uma.title} ${uma.card_id}`, query) }))
    .filter(({ score }) => Number.isFinite(score)).sort((a, b) => a.score - b.score).map(({ uma }) => uma), [full, umas, query]);
  const recentCards = searching || full ? [] : recent.flatMap(id => {
    const uma = umas.find(card => card.card_id === id);
    return uma ? [uma] : [];
  });
  const canClear = Number.isFinite(fuzzyScore('No Uma', query));

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    search.current?.focus();
    return () => element.close();
  }, []);

  const card = (uma: CatalogUma, compact = false) => <button key={uma.card_id} type="button"
    aria-label={`${uma.name} ${uma.title}`} aria-pressed={selected?.card_id === uma.card_id} onClick={() => onPick(uma)}>
    <Portrait uma={uma}/><span className="stamina-uma-card-text"><strong>{uma.name}</strong>{!compact && <small>{uma.title}</small>}</span>
  </button>;

  return <dialog className="panel stamina-uma-dialog" ref={dialog} aria-labelledby={title}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <div className="drawer-heading"><h2 id={title}>Choose Uma</h2><button type="button" aria-label="Close Uma picker" onClick={onClose}>×</button></div>
    <div className="stamina-uma-search">
      <input ref={search} type="search" aria-label="Search Umas" placeholder="Search by name or title…" value={query}
        onChange={event => { setQuery(event.target.value); if (grid.current) grid.current.scrollTop = 0; }} onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (query.trim().toLowerCase() === 'no uma') onPick(undefined);
          else if (matches[0] || canClear) onPick(matches[0]);
        }}/>
      {canClear && <button type="button" onClick={() => onPick(undefined)}>No Uma</button>}
    </div>
    {recentCards.length > 0 && <section className="stamina-uma-recent" aria-label="Recent">
      <h3>Recent</h3><div>{recentCards.map(uma => card(uma, true))}</div>
    </section>}
    <div ref={grid} className="stamina-uma-grid" role="group" aria-label={searching ? 'Matching Umas' : 'All Umas'}>
      {matches.map(uma => card(uma))}
      {full ? <p role="status">Remove a skill to choose an Uma.</p> : !matches.length && <p role="status">No matching Umas.</p>}
    </div>
  </dialog>;
}

export function StaminaUmaPicker({ umas, selected, recent, hasUnique = false, full, locked = false, onSelect, onAptitudes }: {
  umas: CatalogUma[];
  selected: CatalogUma | undefined;
  recent: number[];
  hasUnique?: boolean;
  full: boolean;
  locked?: boolean;
  onSelect: (uma: CatalogUma | undefined) => void;
  onAptitudes?: (aptitudes: CatalogUma['aptitudes']) => void;
}) {
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setPortal(null); requestAnimationFrame(() => trigger.current?.focus()); };

  return <div className="field stamina-uma-field">
    <span>Uma</span>
    <div className={onAptitudes ? 'stamina-uma-actions' : 'stamina-uma-single'}>
      <button type="button" className="stamina-uma-trigger" ref={trigger} disabled={locked} aria-haspopup="dialog" aria-expanded={!!portal}
        onClick={event => setPortal(event.currentTarget.closest<HTMLElement>('.stamina-layout'))}>
        {selected && <Portrait uma={selected}/>}
        <span className="stamina-uma-name">{selected ? `${selected.name} ${selected.title}` : hasUnique ? 'Choose Uma' : 'No Uma'}</span>
        <span className="stamina-uma-chevron" aria-hidden="true">…</span>
      </button>
      {onAptitudes && <button type="button" className="stamina-uma-aptitudes" disabled={!selected} onClick={() => { if (selected) onAptitudes(selected.aptitudes); }}>Use base aptitudes</button>}
    </div>
    {portal && createPortal(<UmaDialog umas={umas} recent={recent} selected={selected} full={full} onClose={close}
      onPick={uma => { onSelect(uma); close(); }}/>, portal)}
  </div>;
}
