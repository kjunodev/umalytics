import { browser } from 'wxt/browser';
import type { PrematchRoster } from '@umalytics/shared';

export const LOBBY_LOCK_STORAGE_KEY = 'lobbyLock';

export interface LobbyLockState {
  locked: boolean;
  roster?: PrematchRoster;
  lockedAt?: number;
}

type LobbyLockStorage = {
  [LOBBY_LOCK_STORAGE_KEY]?: LobbyLockState;
};

export async function getLobbyLockState(): Promise<LobbyLockState | undefined> {
  const values = (await browser.storage.local.get(LOBBY_LOCK_STORAGE_KEY)) as LobbyLockStorage;

  return values[LOBBY_LOCK_STORAGE_KEY];
}

export async function setLobbyLockState(state: LobbyLockState): Promise<void> {
  await browser.storage.local.set({
    [LOBBY_LOCK_STORAGE_KEY]: state
  } satisfies LobbyLockStorage);
}

export async function clearLobbyLockState(): Promise<void> {
  await browser.storage.local.remove(LOBBY_LOCK_STORAGE_KEY);
}
