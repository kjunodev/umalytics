import { useState, type InputHTMLAttributes } from 'react';
import { numberFieldValue } from './numberFieldValue';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number; min: number; max: number; onChange: (value: number) => void;
};

export function NumberField({ value, min, max, onChange, onFocus, onBlur, onKeyDown, ...props }: Props) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  return <input {...props} type="number" step={1} min={min} max={max} value={editing ? draft : String(value)}
    onFocus={event => { setDraft(String(value)); setEditing(true); onFocus?.(event); }}
    onChange={event => {
      const text = event.target.value;
      setDraft(text); setEditing(true);
      const next = numberFieldValue(text, min, max);
      if (next !== undefined) onChange(next);
    }}
    onBlur={event => { setEditing(false); onBlur?.(event); }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); setDraft(String(value)); setEditing(false); }
      onKeyDown?.(event);
    }}/>;
}
