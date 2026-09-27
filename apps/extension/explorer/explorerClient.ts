import { browser } from 'wxt/browser';
import type { PlayerProfileSummary, PlayerStatsScope, PrematchPlayer } from '@umalytics/shared';
import type { SeasonLeaderboard } from '../profiles/playerProfileApi';
import { EXPLORER_PORT, type ExplorerRequest, type ExplorerReply, type HistoricalMatch, type PlayerSearchResult } from './explorerTypes';

function request<T>(message: ExplorerRequest, signal: AbortSignal, onProgress?: (profiles: Record<string, PlayerProfileSummary>) => void): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connect({ name: EXPLORER_PORT });
    let finished = false;
    const finish = (error?: Error, value?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      port.onMessage.removeListener(receive);
      port.onDisconnect.removeListener(disconnect);
      port.disconnect();
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => finish(new Error('Request cancelled.'));
    const disconnect = () => finish(new Error('Connection interrupted. Please try again.'));
    const receive = (reply: ExplorerReply) => {
      if (signal.aborted || finished) return;
      if (reply.type === 'progress') onProgress?.(reply.profiles);
      else if (reply.type === 'error') finish(Object.assign(new Error(reply.message), { retryAt: reply.retryAt }));
      else if (reply.type === 'result') finish(undefined, reply.data as T);
    };
    const timer = setTimeout(() => finish(new Error('Loading timed out. Please try again.')), 70_000);
    signal.addEventListener('abort', abort, { once: true });
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(disconnect);
    try { port.postMessage(message); } catch { disconnect(); }
    if (signal.aborted) abort();
  });
}

export function loadHistoricalMatch(input: string, signal: AbortSignal) {
  return request<HistoricalMatch>({ kind: 'match', input }, signal);
}
export function searchPlayers(input: string, page: number, signal: AbortSignal) {
  return request<PlayerSearchResult>({ kind: 'search', input, page }, signal);
}
export function loadSeasonLeaderboard(signal: AbortSignal) {
  return request<SeasonLeaderboard>({ kind: 'leaderboard' }, signal);
}
export function loadExplorerProfiles(players: PrematchPlayer[], scope: PlayerStatsScope,
  onProgress: (profiles: Record<string, PlayerProfileSummary>) => void, signal: AbortSignal) {
  return request<Record<string, PlayerProfileSummary>>({ kind: 'profiles', players, scope }, signal, onProgress);
}
