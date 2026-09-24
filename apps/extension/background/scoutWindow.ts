import { browser } from 'wxt/browser';
import type { LobbyReconnectResult } from '../runtime/messaging';

const SCOUT_POPOUT_PATH = '/scout.html';
const SCOUT_POPOUT_WIDTH = 1320;
const SCOUT_POPOUT_HEIGHT = 1100;

let scoutWindowId: number | undefined;
let openingWindow: Promise<void> | undefined;

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
      await browser.windows.update(scoutWindowId, {
        focused: true,
        width: SCOUT_POPOUT_WIDTH,
        height: SCOUT_POPOUT_HEIGHT
      });
      return;
    } catch {
      scoutWindowId = undefined;
    }
  }

  const scoutWindow = await browser.windows.create({
    url: browser.runtime.getURL(SCOUT_POPOUT_PATH),
    type: 'popup',
    width: SCOUT_POPOUT_WIDTH,
    height: SCOUT_POPOUT_HEIGHT,
    focused: true
  });

  scoutWindowId = scoutWindow?.id;
}

function handleScoutWindowRemoved(windowId: number): void {
  if (windowId === scoutWindowId) {
    scoutWindowId = undefined;
  }
}

export {
  SCOUT_POPOUT_PATH,
  SCOUT_POPOUT_WIDTH,
  SCOUT_POPOUT_HEIGHT,
  configureScoutWindow,
  openScoutWindow,
  createOrFocusScoutWindow,
  handleScoutWindowRemoved
};
