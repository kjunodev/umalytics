import type { UiServices, RecentPlayerEntry } from '@umalytics/ui';
import { getCoreStorage } from '@umalytics/core/platform';
import { executeExplorerRequest, explorerError } from '@umalytics/core/explorer/explorerService';
import type { ExplorerRequest, ExplorerResult } from '@umalytics/core/explorer/explorerTypes';
import { fetchPlayerHistoryPage, fetchPlayerProfileTitle } from '@umalytics/core/profiles/playerProfileApi';

const RECENT_PLAYERS_KEY = 'playersRecentViewed';
const historyRequests = new Map<string, AbortController>();
const profileRequests = new Map<string, AbortController>();

async function explorer<T extends ExplorerResult>(request: ExplorerRequest, signal: AbortSignal,
  progress: Parameters<typeof executeExplorerRequest>[2] = () => {}): Promise<T> {
  try { return await executeExplorerRequest(request, signal, progress) as T; }
  catch (error) {
    signal.throwIfAborted();
    const { message, retryAt } = explorerError(error);
    throw Object.assign(new Error(message), { retryAt });
  }
}

async function withRequest<T>(requests: Map<string, AbortController>, requestId: string,
  run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  requests.get(requestId)?.abort();
  const controller = new AbortController();
  requests.set(requestId, controller);
  try {
    const value = await run(controller.signal);
    controller.signal.throwIfAborted();
    return value;
  } finally {
    if (requests.get(requestId) === controller) requests.delete(requestId);
  }
}

async function cancel(requests: Map<string, AbortController>, requestId: string): Promise<void> {
  requests.get(requestId)?.abort();
  requests.delete(requestId);
}

function isRecentPlayer(value: unknown): value is RecentPlayerEntry {
  const record = value as Partial<RecentPlayerEntry> | null;
  return typeof record === 'object' && record !== null &&
    typeof record.discordId === 'string' && typeof record.displayName === 'string';
}

export const desktopUiServices: UiServices = {
  loadHistoricalMatch: (input, signal) => explorer({ kind: 'match', input }, signal),
  loadExplorerProfiles: (players, scope, progress, signal) => explorer({ kind: 'profiles', players, scope }, signal, progress),
  searchPlayers: (input, page, signal) => explorer({ kind: 'search', input, page }, signal),
  loadSeasonLeaderboard: signal => explorer({ kind: 'leaderboard' }, signal),
  sendPlayerHistoryPageRequest: (discordId, scope, page, requestId) =>
    withRequest(historyRequests, requestId, signal => fetchPlayerHistoryPage(discordId, scope, page, signal)),
  cancelPlayerHistoryPageRequest: requestId => cancel(historyRequests, requestId),
  sendPlayerProfileRequest: (discordId, requestId) =>
    withRequest(profileRequests, requestId, signal => fetchPlayerProfileTitle(discordId, signal)),
  cancelPlayerProfileRequest: requestId => cancel(profileRequests, requestId),
  async getRecentPlayers() {
    try {
      const stored = (await getCoreStorage()?.local.get(RECENT_PLAYERS_KEY))?.[RECENT_PLAYERS_KEY];
      return Array.isArray(stored) ? stored.filter(isRecentPlayer) : [];
    } catch { return []; }
  },
  async setRecentPlayers(recent) {
    try { await getCoreStorage()?.local.set({ [RECENT_PLAYERS_KEY]: recent }); }
    catch { /* Recent chips must not block player lookup when storage is unavailable. */ }
  }
};
