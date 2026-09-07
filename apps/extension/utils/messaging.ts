import { browser } from 'wxt/browser';
import type { DraftSnapshot, PrematchRoster } from '@umalytics/shared';

export const ROOM_DOM_SCAN_REQUEST_MESSAGE_TYPE = 'room-dom-scan-requested';

export type LobbyReconnectResult = {
  activeLobby: boolean;
  matchCode?: string;
};

export type RoomDomScanResult = {
  activeLobby: boolean;
  matchCode?: string;
};

export type UmaLyticsMessage = {
  type: 'prematch-roster-detected';
  roster: PrematchRoster;
} | {
  type: 'draft-snapshot-detected';
  snapshot: DraftSnapshot;
} | {
  type: 'profile-refresh-requested';
  roster: PrematchRoster;
} | {
  type: 'lobby-reconnect-requested';
};

export type UmaLyticsContentMessage = {
  type: typeof ROOM_DOM_SCAN_REQUEST_MESSAGE_TYPE;
};

export function isUmaLyticsMessage(value: unknown): value is UmaLyticsMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === 'lobby-reconnect-requested') {
    return true;
  }

  if (value.type === 'draft-snapshot-detected') {
    return isRecord(value.snapshot) && isRecord(value.snapshot.teams);
  }

  if (value.type !== 'prematch-roster-detected' && value.type !== 'profile-refresh-requested') {
    return false;
  }

  return isRecord(value.roster) && Array.isArray(value.roster.players);
}

export function isUmaLyticsContentMessage(value: unknown): value is UmaLyticsContentMessage {
  return isRecord(value) && value.type === ROOM_DOM_SCAN_REQUEST_MESSAGE_TYPE;
}

export async function sendPrematchRoster(roster: PrematchRoster): Promise<void> {
  await browser.runtime.sendMessage({
    type: 'prematch-roster-detected',
    roster
  } satisfies UmaLyticsMessage);
}

export async function sendDraftSnapshot(snapshot: DraftSnapshot): Promise<void> {
  await browser.runtime.sendMessage({
    type: 'draft-snapshot-detected',
    snapshot
  } satisfies UmaLyticsMessage);
}

export async function sendProfileRefreshRequest(roster: PrematchRoster): Promise<void> {
  await browser.runtime.sendMessage({
    type: 'profile-refresh-requested',
    roster
  } satisfies UmaLyticsMessage);
}

export async function sendLobbyReconnectRequest(): Promise<LobbyReconnectResult | undefined> {
  return browser.runtime.sendMessage({
    type: 'lobby-reconnect-requested'
  } satisfies UmaLyticsMessage);
}

export async function sendRoomDomScanRequest(tabId: number): Promise<RoomDomScanResult | undefined> {
  return browser.tabs.sendMessage(tabId, {
    type: ROOM_DOM_SCAN_REQUEST_MESSAGE_TYPE
  } satisfies UmaLyticsContentMessage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
