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

const dependencies: ScoutWindowDependencies = {
  handleLobbyReconnectRequested: async () => ({ activeLobby: false }),
  reportEnrichmentError: () => {}
};

function configureScoutWindow(next: ScoutWindowDependencies): void {
  Object.assign(dependencies, next);
}

function handleLobbyReconnectRequested(): Promise<LobbyReconnectResult> {
  return dependencies.handleLobbyReconnectRequested();
}

function reportEnrichmentError(error: unknown): void {
  dependencies.reportEnrichmentError(error);
}

function openScoutWindow(): Promise<void> {
  if (openingWindow !== undefined) return openingWindow;
  openingWindow = createOrFocusScoutWindow().finally(() => { openingWindow = undefined; });
  return openingWindow;
}

async function createOrFocusScoutWindow(): Promise<void> {
  // The UI can render cached data before any page scan or network request finishes.
  void handleLobbyReconnectRequested().catch(reportEnrichmentError);

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
