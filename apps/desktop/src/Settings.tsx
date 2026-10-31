import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import type { Catalog } from './staminaTypes';
import type { Preferences } from './preferences';

export function Settings({ prefs, update, pinned, busy, togglePin, copyDiagnostics, copyStatus }: {
  prefs: Preferences; update: (patch: Partial<Preferences>) => void; pinned: boolean; busy: boolean; togglePin: () => void; copyDiagnostics: () => void; copyStatus: string;
}) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    void invoke<Catalog>('engine_catalog').then(data => { if (!disposed) setCatalog(data); }).catch(() => { if (!disposed) setError('Local data status unavailable.'); });
    void getVersion().then(v => { if (!disposed) setVersion(v); }).catch(() => { if (!disposed) setVersion('Unavailable'); });
    return () => { disposed = true; };
  }, []);
  return <section className="arena-data settings-layout" aria-label="Settings"><nav aria-label="Settings sections">{['Window', 'Display', 'Data', 'Diagnostics', 'About'].map(s => <a key={s} href={`#settings-${s.toLowerCase()}`}>{s}</a>)}</nav><div className="settings-groups">
    <section className="data-box" id="settings-window"><h2>Window</h2><div className="setting-row"><div><b>Pin on top</b><small>Keeps UmaLytics above the browser</small></div><button role="switch" aria-label="Pin on top" aria-checked={pinned} disabled={busy} onClick={togglePin}>{pinned ? 'On' : 'Off'}</button></div></section>
    <section className="data-box" id="settings-display"><h2>Display</h2>
      <div className="setting-row"><div><b>UI size</b><small>Scales the whole app</small></div><div className="seg" role="group" aria-label="UI size">{(['Small', 'Default', 'Large'] as const).map(value => <button key={value} aria-pressed={prefs.uiSize === value} onClick={() => update({ uiSize: value })}>{value}</button>)}</div></div>
      <div className="setting-row"><div><b>Compact switch width</b><small>Switch below this window width in CSS pixels</small></div><label className="threshold-label"><span className="sr-only">Compact switch width</span><input type="number" aria-label="Compact switch width" min={440} max={1000} step={10} defaultValue={prefs.compactThreshold} onBlur={e => { const value = Number(e.target.value); if (e.target.validity.valid && Number.isInteger(value)) update({ compactThreshold: value }); else e.target.value = String(prefs.compactThreshold); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span>px</span></label></div>
      <div className="setting-row"><div><b>Default stamina target</b><small>Target for subsequent stamina checks</small></div><div className="seg" role="group" aria-label="Default stamina target">{([90, 95, 99] as const).map(target => <button key={target} aria-pressed={prefs.staminaTarget === target} onClick={() => update({ staminaTarget: target })}>{target}%</button>)}</div></div>
    </section>
    <section className="data-box" id="settings-data"><h2>Data</h2><div className="setting-row"><div><b>Local skill data</b><small className="local-data-path">{catalog?.local_skill_path ?? (error || 'Loading folder path…')}</small><small>{catalog ? `${catalog.local_skill_count ?? 0} skills · ${catalog.local_icon_count ?? 0} icons` : 'Reading local data status'}</small></div><span className={catalog?.local_skill_data ? 'win' : 'muted'}>{catalog ? catalog.local_skill_data ? 'Found' : 'Not found' : '—'}</span></div><div className="setting-row"><div><b>Engine data version</b><small>{catalog?.engine_data_version ?? 'Not exposed by the engine'}</small></div></div></section>
    <section className="data-box" id="settings-diagnostics"><h2>Diagnostics</h2><div className="setting-row"><div><b>Local feed</b><small>Listener status and accepted/rejected counts</small></div><button onClick={copyDiagnostics}>Copy diagnostics</button></div><p role="status">{copyStatus}</p></section>
    <section className="data-box" id="settings-about"><h2>About</h2><div className="setting-row"><div><b>UmaLytics {version || '…'}</b><small>Update checks arrive with the first desktop release</small></div></div></section>
  </div></section>;
}
