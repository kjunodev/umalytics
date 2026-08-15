import { browser } from 'wxt/browser';
import type { DraftSnapshot, PrematchRoster } from '@umalytics/shared';

export type LobbyReconnectResult = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
