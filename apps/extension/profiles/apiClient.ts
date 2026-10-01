import { recordDiagnostic } from '../runtime/diagnosticRecorder';
import { abortable, deadline, RequestQueue } from './requestQueue';
import type { RequestPriority } from './requestQueue';
import { browser } from 'wxt/browser';
import { getErrorMessage } from '../room/recordReaders';

const API_ORIGIN = 'https://drafter-api.uma.guide';
const SHARED_CACHE_TTL_MS = 10 * 60 * 1000;
const PROFILE_RESPONSE_TTL_MS = 24 * 60 * 60 * 1000;
const STATS_RESPONSE_TTL_MS = 60 * 1000;
const HISTORY_RESPONSE_TTL_MS = 5 * 60 * 1000;
const RESPONSE_CACHE_STORAGE_KEY = 'profileApiResponsesV1';
const API_RATE_LIMIT_BACKOFF_MS = 30 * 1000;
const API_SERVER_ERROR_BACKOFF_MS = 10 * 1000;
const API_REQUEST_TIMEOUT_MS = 10 * 1000;
export const PROFILE_SUMMARY_TIMEOUT_MS = 60 * 1000;
const DEFAULT_REQUEST_INTERVAL_MS = 350;
const PACING_RECOVERY_SUCCESS_STREAK = 20;
const PACING_RECOVERY_FACTOR = 0.75;
let baseRequestIntervalMs = DEFAULT_REQUEST_INTERVAL_MS;
let requestStartIntervalMs = baseRequestIntervalMs;
let consecutiveSuccessCount = 0;
const requestQueue = new RequestQueue(3, requestStartIntervalMs);


export interface ApiCooldown { until: number; status: number; path: string; startIntervalMs?: number }
let apiCooldown: ApiCooldown | undefined;
const responseCache = new Map<string, { value: unknown; expiresAt: number }>();
const inFlightRequests = new Map<string, { promise: Promise<unknown>; controller: AbortController; consumers: number }>();
let persistentCacheLoad: Promise<void> | undefined;
let persistentCacheWriteTimer: ReturnType<typeof setTimeout> | undefined;
let persistentCacheWriteInFlight = false;
let persistentCacheDirty = false;

export function getApiCooldown(): ApiCooldown | undefined { return apiCooldown; }
export function restoreApiCooldown(value: ApiCooldown): void {
  if (value.until > (apiCooldown?.until ?? 0)) apiCooldown = value;
  requestStartIntervalMs = Math.max(requestStartIntervalMs, Math.min(2000, value.startIntervalMs ?? baseRequestIntervalMs));
  consecutiveSuccessCount = 0;
  requestQueue.setStartInterval(requestStartIntervalMs);
}

function cacheTtl(path: string): number {
  if (path === '/api/seasons' || path.startsWith('/api/leaderboard?')) return SHARED_CACHE_TTL_MS;
  if (path.includes('/history?')) return HISTORY_RESPONSE_TTL_MS;
  if (path.endsWith('/profile')) return PROFILE_RESPONSE_TTL_MS;
  return STATS_RESPONSE_TTL_MS;
}

function isPersistentResponse(path: string): boolean {
  return path === '/api/seasons' || path.startsWith('/api/leaderboard?') || path.endsWith('/profile');
}

function loadPersistentResponses(): Promise<void> {
  return persistentCacheLoad ??= (async () => {
    if (typeof browser === 'undefined' || browser.storage?.session === undefined) return;
    try {
      const stored = await browser.storage.session.get(RESPONSE_CACHE_STORAGE_KEY);
      const entries = stored[RESPONSE_CACHE_STORAGE_KEY] as Record<string, { value: unknown; expiresAt: number }> | undefined;
      for (const [path, entry] of Object.entries(entries ?? {})) {
        if (!isPersistentResponse(path) || !Number.isFinite(entry?.expiresAt) || entry.expiresAt <= Date.now()) continue;
        if ((responseCache.get(path)?.expiresAt ?? 0) < entry.expiresAt) responseCache.set(path, entry);
      }
    } catch { /* Session storage can be unavailable; the memory cache still works. */ }
  })();
}

function persistResponses(): void {
  if (typeof browser === 'undefined' || browser.storage?.session === undefined) return;
  persistentCacheDirty = true;
  if (persistentCacheWriteTimer !== undefined || persistentCacheWriteInFlight) return;
  persistentCacheWriteTimer = setTimeout(() => {
    persistentCacheWriteTimer = undefined;
    void flushPersistentResponses();
  }, 250);
}

async function flushPersistentResponses(): Promise<void> {
  if (!persistentCacheDirty || persistentCacheWriteInFlight) return;
  persistentCacheDirty = false;
  persistentCacheWriteInFlight = true;
  const entries = [...responseCache].filter(([path, entry]) => isPersistentResponse(path) && entry.expiresAt > Date.now())
    .sort((a, b) => b[1].expiresAt - a[1].expiresAt);
  const shared = entries.filter(([path]) => !path.endsWith('/profile'));
  const profiles = entries.filter(([path]) => path.endsWith('/profile')).slice(0, 200);
  const snapshot = Object.fromEntries([...shared, ...profiles]);
  try {
    await browser.storage.session.set({ [RESPONSE_CACHE_STORAGE_KEY]: snapshot });
  } catch { /* Session storage can be unavailable; the memory cache still works. */ }
  finally {
    persistentCacheWriteInFlight = false;
    if (persistentCacheDirty) persistResponses();
  }
}

export async function fetchJson<T>(
  path: string, signal?: AbortSignal, priority: RequestPriority = 'background', endpointLabel?: string
): Promise<T> {
  signal?.throwIfAborted();
  let shared = inFlightRequests.get(path);
  if (shared === undefined) {
    const controller = new AbortController();
    shared = { promise: fetchJsonOnce<T>(path, controller.signal, priority, endpointLabel), controller, consumers: 0 };
    inFlightRequests.set(path, shared);
    const request = shared;
    void request.promise.finally(() => {
      if (inFlightRequests.get(path) === request) inFlightRequests.delete(path);
    }).catch(() => {});
  }
  shared.consumers += 1;
  const request = shared;
  const budget = deadline(signal, PROFILE_SUMMARY_TIMEOUT_MS, `Request queue timed out: ${path}`);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    request.consumers -= 1;
    if (request.consumers === 0) {
      if (inFlightRequests.get(path) === request) inFlightRequests.delete(path);
      request.controller.abort(new Error('Request cancelled.'));
    }
  };
  budget.signal.addEventListener('abort', release, { once: true });
  try {
    return await abortable(request.promise as Promise<T>, budget.signal);
  } finally {
    budget.signal.removeEventListener('abort', release);
    budget.dispose();
    release();
  }
}

async function fetchJsonOnce<T>(path: string, signal: AbortSignal, priority: RequestPriority, endpointLabel?: string): Promise<T> {
  await loadPersistentResponses();
  signal.throwIfAborted();
  // The last path segment can be a dynamic ID (e.g. a match code), which would
  // fragment diagnostics per-request; callers with such paths pass a stable label.
  const endpoint = endpointLabel ?? path.split('?')[0]!.split('/').at(-1);
  const cached = responseCache.get(path);
  if (cached !== undefined && cached.expiresAt > Date.now()) { recordDiagnostic({ kind: 'cache', endpoint, reason: 'hit' }); return cached.value as T; }
  assertApiAvailable(path);
  const queuedAt = Date.now();
  const queueBudget = deadline(signal, PROFILE_SUMMARY_TIMEOUT_MS, `Request queue timed out: ${path}`);
  try {
    return await requestQueue.run(queueBudget.signal, async () => {
      const startedAt = Date.now();
      const budget = deadline(queueBudget.signal, API_REQUEST_TIMEOUT_MS, `Request timed out: ${path}`);
      try {
      // Do not hold profiles in an invisible sleep, or retry a rate-limited API in a burst.
      assertApiAvailable(path);
      const response = await fetch(new URL(path, API_ORIGIN), {
        cache: 'no-store', credentials: 'omit', signal: budget.signal
      });
      if (!response.ok) {
        recordDiagnostic({ kind: 'request', endpoint, reason: 'http-error', status: response.status, queueMs: startedAt - queuedAt, networkMs: Date.now() - startedAt });
        // Release an error response body without keeping a connection occupied.
        void response.body?.cancel().catch(() => undefined);
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = response.headers.get('retry-after');
          const seconds = retryAfter === null ? NaN : Number(retryAfter);
          const dateMs = retryAfter === null ? NaN : Date.parse(retryAfter);
          const delayMs = Number.isFinite(seconds) ? seconds * 1000
            : Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now())
            : response.status === 429 ? API_RATE_LIMIT_BACKOFF_MS : API_SERVER_ERROR_BACKOFF_MS;
          restoreApiCooldown({ until: Date.now() + Math.max(1000, delayMs), status: response.status, path,
            startIntervalMs: response.status === 429 ? Math.min(2000, requestStartIntervalMs * 2) : requestStartIntervalMs });
        }
        throw new ApiRequestError(response.status, `Request failed (HTTP ${response.status}): ${path}`);
      }
      const value = await response.json() as T;
      budget.signal.throwIfAborted();
      recordDiagnostic({ kind: 'request', endpoint, reason: 'success', status: response.status, queueMs: startedAt - queuedAt, networkMs: Date.now() - startedAt });
      consecutiveSuccessCount += 1;
      if (requestStartIntervalMs > baseRequestIntervalMs && consecutiveSuccessCount % PACING_RECOVERY_SUCCESS_STREAK === 0) {
        requestStartIntervalMs = Math.max(baseRequestIntervalMs, requestStartIntervalMs * PACING_RECOVERY_FACTOR);
        requestQueue.setStartInterval(requestStartIntervalMs);
      }
      // Cache successes only, so a partial retry does not re-download healthy endpoints.
      for (const [key, entry] of responseCache) if (entry.expiresAt <= Date.now()) responseCache.delete(key);
      if (responseCache.size >= 256) responseCache.delete(responseCache.keys().next().value!);
      responseCache.set(path, { value, expiresAt: Date.now() + cacheTtl(path) });
      if (isPersistentResponse(path)) persistResponses();
      return value;
      } catch (error) {
        if (!(error instanceof ApiRequestError)) recordDiagnostic({ kind: 'request', endpoint,
          reason: signal?.aborted ? 'cancelled' : /timed out/i.test(getErrorMessage(error, '')) ? 'timeout' : 'network-error', queueMs: startedAt - queuedAt, networkMs: Date.now() - startedAt });
        throw error;
      } finally { budget.dispose(); }
    }, priority);
  } finally {
    queueBudget.dispose();
  }
}

function assertApiAvailable(path: string): void {
  if (apiCooldown !== undefined && apiCooldown.until > Date.now()) {
    throw new Error(`API paused after HTTP ${apiCooldown.status} at ${apiCooldown.path}; retry after ${new Date(apiCooldown.until).toISOString()}. Pending: ${path}`);
  }
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}
