import { useState } from 'react';
import type { UpdateControls } from './useUpdater';
import { updateBanner } from './updateState';

export function UpdateBanner({ updates, roomActive }: { updates: UpdateControls; roomActive: boolean }) {
  const [notes, setNotes] = useState(false);
  const state = updates.state;
  const mode = updateBanner(state, roomActive);
  return <div className="update-slot">
    {mode !== 'hidden' && <aside className={`update-banner ${mode}`} aria-label="App update" role="status">
      {mode === 'downloading' && <span>UmaLytics {state.version} is downloading…</span>}
      {mode === 'ready' && <><span>UmaLytics {state.version} is ready</span><span aria-hidden="true">·</span><button onClick={updates.install}>Update and restart</button><button onClick={() => setNotes(!notes)} aria-expanded={notes}>What's new</button></>}
      {mode === 'deferred' && <><span>UmaLytics {state.version} is ready · Live room active</span><button onClick={updates.install}>Restart now</button></>}
      {mode === 'error' && <><span>Update failed</span><span aria-hidden="true">·</span><button onClick={updates.check}>Retry</button></>}
      {mode === 'installing' && <span>Installing update…</span>}
      {mode !== 'installing' && <button className="update-dismiss" aria-label="Dismiss update" onClick={() => { setNotes(false); updates.dismiss(); }}>×</button>}
    </aside>}
    {notes && mode === 'ready' && <section className="update-notes" aria-label="What's new"><h2>UmaLytics {state.version}</h2><p>{state.notes || 'No release notes provided.'}</p><button onClick={() => setNotes(false)}>Close</button></section>}
  </div>;
}
