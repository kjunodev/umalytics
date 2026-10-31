import type { StaminaInput } from './staminaTypes';

const toggles = [['assume_skills_activate', 'Assume skills activate'], ['rushed', 'Rushed'], ['spot_struggle', 'Spot Struggle'], ['dueling', 'Dueling'], ['lane_movement', 'Lane movement']] as const;
export function RaceSettings({ input, onChange, onMood }: { input: StaminaInput; onChange: (patch: Partial<StaminaInput>) => void; onMood: (mood: number) => void }) {
  return <>
    <div className="field"><span>Target</span><div className="seg" role="group" aria-label="Target">{([90, 95, 99] as const).map(target => <button type="button" key={target} aria-pressed={input.target === target} onClick={() => onChange({ target })}>{target}%</button>)}</div><small className="muted">Higher targets use more samples and take longer.</small></div>
    <div className="field"><span>Field</span><div className="seg field-options" role="group" aria-label="Field">{(['average_lobby', 'mirror', 'pacemaker'] as const).map(field => <button type="button" key={field} aria-pressed={input.field === field} onClick={() => onChange({ field })}>{field === 'average_lobby' ? 'Average lobby' : field === 'mirror' ? 'Mirror' : '2-runner (skill position conditions see 2 runners)'}</button>)}</div><small className="muted">{input.field === 'mirror' ? '8 opponents with your submitted stats · A aptitudes · Great · no skills · 2 Front / 3 Pace / 2 Late / 1 End.' : input.field === 'average_lobby' ? '8 opponents · 1600/1200/1200/600/1200 · A aptitudes · Great · no skills.' : 'One Front runner; position conditions see 2 runners.'}</small></div>
    {toggles.map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={input[key]} onChange={event => onChange({ [key]: event.target.checked })}/></label>)}
    <small className="muted">Assume skills activate passes Wit checks. Timing and position conditions still apply.</small>
    <label>Mood<select aria-label="Mood" value={input.build.motivation} onChange={event => onMood(Number(event.target.value))}>{['Awful', 'Bad', 'Normal', 'Good', 'Great'].map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
  </>;
}
