import { browser } from 'wxt/browser';

const TRACE_KEY = 'diagnosticTraceV1';
const TRACE_LIMIT = 200;
let trace: Record<string, string | number>[] = [];
let loaded: Promise<void> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let writes = Promise.resolve();

/** Strict field/value allowlist: never store payloads, names, player identifiers,
 * URLs, chat text, request/assignment tokens, or arbitrary error strings. */
export function sanitizeDiagnostic(value: unknown): Record<string, string | number> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (!['room','roster','request','cache'].includes(String(input.kind))) return undefined;
  const output: Record<string, string | number> = { kind: String(input.kind) };
  const reasons = ['unsupported-event','unrelated-room','old-version','old-assignment-revision','match-snapshot','team-assignment','captain-without-roster','captain-change','presence-without-roster','presence-update','dom','synced','success','http-error','cancelled','timeout','network-error','hit'];
  if (reasons.includes(String(input.reason))) output.reason = String(input.reason);
  if (typeof input.room === 'string' && /^[A-Z0-9]{6}$/.test(input.room)) output.room = input.room;
  if (typeof input.phase === 'string' && ['lobby','reveal','pre-draft-pause','map-pick','map-ban','post-map-pause','uma-pre-ban','uma-pick','uma-ban','complete','aram-wildcard-roll','aram-map-roll','aram-uma-roll','aram-extra-roll'].includes(input.phase)) output.phase = input.phase;
  if (['profile','stats','history','seasons','leaderboard'].includes(String(input.endpoint))) output.endpoint = String(input.endpoint);
  for (const field of ['version','team1','team2','status','queueMs','networkMs']) {
    const n = input[field];
    if (typeof n === 'number' && Number.isFinite(n) && n >= -1 && n <= 1_000_000_000) output[field] = Math.round(n);
  }
  return output;
}

function loadTrace(): Promise<void> {
  return loaded ??= browser.storage.local.get(TRACE_KEY).then(values => {
    const saved = values[TRACE_KEY];
    if (Array.isArray(saved)) trace = saved.slice(-TRACE_LIMIT).flatMap(value => {
      const clean = sanitizeDiagnostic(value);
      return clean && typeof value.at === 'number' && Number.isFinite(value.at) ? [{ ...clean, at: value.at }] : [];
    });
  }).catch(() => {});
}

export function recordDiagnostic(value: unknown): void {
  const clean = sanitizeDiagnostic(value);
  if (!clean) return;
  void loadTrace().then(() => {
    const last = trace.at(-1);
    if (last && JSON.stringify({ ...last, at: undefined }) === JSON.stringify({ ...clean, at: undefined })) return;
    trace.push({ ...clean, at: Date.now() });
    if (trace.length > TRACE_LIMIT) trace.splice(0, trace.length - TRACE_LIMIT);
    if (flushTimer === undefined) flushTimer = setTimeout(() => {
      flushTimer = undefined;
      const snapshot = [...trace];
      writes = writes.then(() => browser.storage.local.set({ [TRACE_KEY]: snapshot })).catch(() => {});
    }, 1000);
  });
}

export async function getDiagnosticTrace(): Promise<Record<string, string | number>[]> {
  await loadTrace();
  return trace.map(entry => ({ ...entry }));
}
