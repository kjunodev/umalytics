import type { DraftRun } from './Stamina';
import { passes } from './staminaDraft';

export function CompactStamina({ run, onOpen }: { run?: DraftRun; onOpen: () => void }) {
  if (!run?.results.some(Boolean)) return null;
  return <button className="compact-stamina-strip" aria-label="Open stamina for draft races" onClick={onOpen}>
    <span><b>{run.results.filter(result => result && passes(result)).length} / 7 pass</b> · draft stamina</span>
    <span className="stamina-pips">{Array.from({ length: 7 }, (_, index) => {
      const result = run.results[index];
      const needed = result?.needed_effective_stamina.joint;
      const label = result ? passes(result) ? 'Pass' : 'Short' : 'Pending';
      const amount = needed == null ? '—' : Math.round(needed).toLocaleString('en-US');
      return <span key={index} className={label.toLowerCase()} title={`${run.slots[index]?.raw ?? 'Awaiting race'}: ${label} · needs ${amount}`}>
        <b>{index + 1}</b><small>{label}</small><small>{amount}</small>
      </span>;
    })}</span>
  </button>;
}
