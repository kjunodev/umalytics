import { browser } from 'wxt/browser';
import type { ScriptPublicPath } from '#imports';
import { sendRoomDomScanRequest, type RoomDomScanResult } from '../runtime/messaging';
import { extractMatchCodeFromUrl } from '../room/matchDetection';

const CONTENT_SCRIPT_PATH = '/content-scripts/content.js' as ScriptPublicPath;
const DRAFTER_URL_PATTERN = 'https://drafter.uma.guide/*';

async function reconnectOpenDrafterTabs(): Promise<void> {
  const tabs = await browser.tabs.query({ url: DRAFTER_URL_PATTERN });
  await Promise.all(tabs.map((tab) => injectContentScriptIntoTab(tab.id)));
}

async function injectContentScriptIntoTab(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) {
    return;
  }

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_PATH]
    });
  } catch (caught) {
    console.debug('[UmaLytics] Content script reconnect skipped:', caught);
  }
}

async function getActiveDrafterTab(): Promise<Browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeCurrentWindowTab = tabs.find((tab) => tab.url?.startsWith('https://drafter.uma.guide/') === true);

  if (activeCurrentWindowTab !== undefined) {
    return activeCurrentWindowTab;
  }

  const drafterTabs = await browser.tabs.query({ url: DRAFTER_URL_PATTERN });

  return (
    drafterTabs.find((tab) => tab.active) ??
    drafterTabs.find((tab) => getTabMatchCode(tab) !== undefined) ??
    drafterTabs[0]
  );
}

async function requestRoomDomScan(
  tabId: number | undefined,
  options: { force?: boolean } = {}
): Promise<RoomDomScanResult | undefined> {
  if (tabId === undefined) {
    return undefined;
  }

  try {
    return await sendRoomDomScanRequest(tabId, options);
  } catch (caught) {
    await injectContentScriptIntoTab(tabId);
    try { return await sendRoomDomScanRequest(tabId, options); }
    catch (retryError) {
      console.debug('[UmaLytics] Room DOM scan request skipped:', retryError);
      return undefined;
    }
  }
}

function getTabMatchCode(tab: Browser.tabs.Tab | undefined): string | undefined {
  if (tab?.url === undefined) {
    return undefined;
  }

  try {
    return extractMatchCodeFromUrl(tab.url);
  } catch {
    return undefined;
  }
}

export {
  CONTENT_SCRIPT_PATH,
  DRAFTER_URL_PATTERN,
  getActiveDrafterTab,
  injectContentScriptIntoTab,
  reconnectOpenDrafterTabs,
  getTabMatchCode,
  requestRoomDomScan
};
