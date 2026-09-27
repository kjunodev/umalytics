import { browser } from 'wxt/browser';
import type { LobbyReconnectResult } from '../runtime/messaging';

const SCOUT_POPOUT_PATH = '/scout.html';
const SCOUT_DEFAULT_WIDTH = 1500;
const SCOUT_DEFAULT_HEIGHT = 900;
const SCOUT_WINDOW_BOUNDS_STORAGE_KEY = 'scoutWindowBounds';
// onBoundsChanged fires continuously while the user drags or resizes; only
// persist once movement has settled.
const BOUNDS_SAVE_DEBOUNCE_MS = 500;

export interface ScoutWindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface WorkArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

let scoutWindowId: number | undefined;
let openingWindow: Promise<void> | undefined;
let boundsSaveTimer: ReturnType<typeof setTimeout> | undefined;

interface ScoutWindowDependencies {
  handleLobbyReconnectRequested: () => Promise<LobbyReconnectResult>;
  reportEnrichmentError: (error: unknown) => void;
}

let dependencies: ScoutWindowDependencies | undefined;

function configureScoutWindow(next: ScoutWindowDependencies): void {
  dependencies = next;
}

function requestLobbyReconnect(): Promise<LobbyReconnectResult> {
  if (dependencies === undefined) throw new Error('scoutWindow not configured');
  return dependencies.handleLobbyReconnectRequested();
}

function reportScoutWindowError(error: unknown): void {
  if (dependencies === undefined) throw new Error('scoutWindow not configured');
  dependencies.reportEnrichmentError(error);
}

function openScoutWindow(): Promise<void> {
  if (openingWindow !== undefined) return openingWindow;
  openingWindow = createOrFocusScoutWindow().finally(() => { openingWindow = undefined; });
  return openingWindow;
}

async function createOrFocusScoutWindow(): Promise<void> {
  // The UI can render cached data before any page scan or network request finishes.
  void requestLobbyReconnect().catch(reportScoutWindowError);

  if (scoutWindowId !== undefined) {
    try {
      // Focus only. Resizing here would undo a size or position the user
      // deliberately set, every time they reopen the scout window.
      await browser.windows.update(scoutWindowId, { focused: true });
      return;
    } catch {
      scoutWindowId = undefined;
    }
  }

  const bounds = await resolveInitialScoutBounds();
  const scoutWindow = await browser.windows.create({
    url: browser.runtime.getURL(SCOUT_POPOUT_PATH),
    type: 'popup',
    focused: true,
    ...bounds
  });

  scoutWindowId = scoutWindow?.id;
}

// Remembered bounds take priority (restoring exactly where and how big the
// user last left it); a first-ever open falls back to a sensible default.
// Either way, the result is clamped to a reference area (the browser's own
// last-focused window), so a since-unplugged second monitor can never leave
// the window oversized or off-screen. This deliberately doesn't use
// chrome.system.display: it needs its own permission, and Firefox doesn't
// implement it at all, so the browser's own window bounds are the only
// screen-size signal available on both without adding one.
async function resolveInitialScoutBounds(): Promise<Partial<ScoutWindowBounds>> {
  const referenceArea = await getReferenceWindowArea();
  const remembered = await getRememberedScoutBounds();

  if (remembered !== undefined) {
    return clampBoundsToWorkArea(remembered, referenceArea);
  }

  const defaultBounds = { width: SCOUT_DEFAULT_WIDTH, height: SCOUT_DEFAULT_HEIGHT };
  return referenceArea === undefined ? defaultBounds : clampSizeToWorkArea(defaultBounds, referenceArea);
}

async function getReferenceWindowArea(): Promise<WorkArea | undefined> {
  try {
    const lastFocused = await browser.windows.getLastFocused();
    const { left, top, width, height } = lastFocused;
    if (left === undefined || top === undefined || width === undefined || height === undefined) return undefined;
    return { left, top, width, height };
  } catch {
    return undefined;
  }
}

function clampSizeToWorkArea(
  size: { width: number; height: number },
  workArea: WorkArea
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.min(size.width, workArea.width)),
    height: Math.max(1, Math.min(size.height, workArea.height))
  };
}

function clampBoundsToWorkArea(bounds: ScoutWindowBounds, workArea: WorkArea | undefined): ScoutWindowBounds {
  if (workArea === undefined) return bounds;

  const { width, height } = clampSizeToWorkArea(bounds, workArea);
  const left = Math.min(Math.max(bounds.left, workArea.left), workArea.left + workArea.width - width);
  const top = Math.min(Math.max(bounds.top, workArea.top), workArea.top + workArea.height - height);

  return { left, top, width, height };
}

async function getRememberedScoutBounds(): Promise<ScoutWindowBounds | undefined> {
  const values = await browser.storage.local.get(SCOUT_WINDOW_BOUNDS_STORAGE_KEY);
  const stored = values[SCOUT_WINDOW_BOUNDS_STORAGE_KEY];
  return isScoutWindowBounds(stored) ? stored : undefined;
}

function isScoutWindowBounds(value: unknown): value is ScoutWindowBounds {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<ScoutWindowBounds>;
  return (['left', 'top', 'width', 'height'] as const).every(
    (key) => typeof record[key] === 'number' && Number.isFinite(record[key])
  );
}

function handleScoutWindowRemoved(windowId: number): void {
  if (windowId === scoutWindowId) {
    scoutWindowId = undefined;
  }
}

// Chrome-only API (no equivalent event in Firefox); background.ts only wires
// this listener up when it exists.
function handleScoutWindowBoundsChanged(window: { id?: number; left?: number; top?: number; width?: number; height?: number }): void {
  if (window.id === undefined || window.id !== scoutWindowId) return;
  const { left, top, width, height } = window;
  if (left === undefined || top === undefined || width === undefined || height === undefined) return;

  if (boundsSaveTimer !== undefined) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = undefined;
    void browser.storage.local.set({
      [SCOUT_WINDOW_BOUNDS_STORAGE_KEY]: { left, top, width, height } satisfies ScoutWindowBounds
    });
  }, BOUNDS_SAVE_DEBOUNCE_MS);
}

export {
  SCOUT_POPOUT_PATH,
  SCOUT_DEFAULT_WIDTH,
  SCOUT_DEFAULT_HEIGHT,
  SCOUT_WINDOW_BOUNDS_STORAGE_KEY,
  configureScoutWindow,
  openScoutWindow,
  createOrFocusScoutWindow,
  handleScoutWindowRemoved,
  handleScoutWindowBoundsChanged,
  resolveInitialScoutBounds,
  clampBoundsToWorkArea,
  clampSizeToWorkArea
};
