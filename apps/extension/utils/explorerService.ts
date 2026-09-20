import { browser } from 'wxt/browser';
import type { PlayerProfileSummary, PrematchPlayer } from '@umalytics/shared';
import { fetchJson, fetchPlayerProfileSummaries, getApiCooldown } from './playerProfileApi';
import { getCachedPlayerProfiles, rememberCachedPlayerProfiles } from './profileStorage';
import { BEST_UMA_SCORE_VERSION, PROFILE_CACHE_TTL_MS, RECENT_HISTORY_VERSION } from './profileConstants';
import { hasCurrentHistoryState } from './profileMerge';
import { lookupPlayer, parseHistoricalMatch, parseHistoryInput, parsePlayerInput, parsePlayerSearch } from './explorerData';
import { EXPLORER_PORT, type ExplorerRequest, type ExplorerReply, type ExplorerResult } from './explorerTypes';

export function validateExplorerRequest(value: unknown): ExplorerRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid lookup request.');
  const input = value as Record<string, unknown>;
  if ((input.kind === 'match' || input.kind === 'search') && typeof input.input === 'string' && input.input.length <= 300) {
    if (input.kind === 'match') return { kind: 'match', input: input.input };
    if (Number.isInteger(input.page) && Number(input.page) >= 1 && Number(input.page) <= 5) return { kind: 'search', input: input.input, page: Number(input.page) };
  }
  if (input.kind === 'profiles' && (input.scope === 'currentSeason' || input.scope === 'allTime') && Array.isArray(input.players) && input.players.length <= 10) {
    const players = input.players.map((value: unknown): PrematchPlayer => {
      const player = value as Record<string, unknown> | null;
      if (!player || typeof player.discordId !== 'string' || !/^\d{16,20}$/.test(player.discordId)) throw new Error('Invalid player ID.');
      return lookupPlayer(player.discordId, typeof player.displayName === 'string' ? player.displayName.slice(0,100) : player.discordId);
    });
    return { kind: 'profiles', scope: input.scope, players };
  }
  throw new Error('Invalid lookup request.');
}

export async function executeExplorerRequest(request: ExplorerRequest, signal: AbortSignal,
  progress: (profiles: Record<string, PlayerProfileSummary>) => void): Promise<ExplorerResult> {
  signal.throwIfAborted();
  if (request.kind === 'match') {
    const code = parseHistoryInput(request.input);
    return parseHistoricalMatch(await fetchJson<unknown>(`/api/matches/${code}`, signal), code);
  }
  if (request.kind === 'search') {
    const { id, query } = parsePlayerInput(request.input);
    if (id) return { players: [lookupPlayer(id)], total: 1, page: 1, pageSize: 10 };
    // The directory exposes a capped result set, not a paged global leaderboard.
    const params = new URLSearchParams({ query: query!, limit: '50' });
    return parsePlayerSearch(await fetchJson<unknown>(`/api/players/directory-search?${params}`, signal), request.page);
  }
  const profiles: Record<string, PlayerProfileSummary> = {};
  const archive = await getCachedPlayerProfiles();
  signal.throwIfAborted();
  const pending = request.players.filter(player => {
    const cached = archive[player.discordId];
    if (cached && !cached.error && !cached.isPartial && cached.statsScope === request.scope &&
      hasCurrentHistoryState(cached, request.scope) &&
      cached.bestUmaScoreVersion === BEST_UMA_SCORE_VERSION && cached.recentHistoryVersion === RECENT_HISTORY_VERSION &&
      Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL_MS) {
      profiles[player.discordId] = cached;
      return false;
    }
    return true;
  });
  if (Object.keys(profiles).length) progress({ ...profiles });
  const update = (profile: PlayerProfileSummary) => {
    if (signal.aborted) return;
    profiles[profile.discordId] = profile;
    progress({ ...profiles });
  };
  if (pending.length) {
    const loaded = await fetchPlayerProfileSummaries(pending, { scope: request.scope, signal, onProgress: update, onSummary: update });
    signal.throwIfAborted();
    Object.assign(profiles, loaded);
    await rememberCachedPlayerProfiles(Object.fromEntries(Object.entries(loaded).filter(([, profile]) => !profile.error && !profile.isPartial)));
  }
  return profiles;
}

export function explorerError(error: unknown): { message: string; retryAt?: number } {
  const cooldown = getApiCooldown();
  if (cooldown && cooldown.until > Date.now()) return {
    message: `The drafter API is temporarily paused. Try again after ${new Date(cooldown.until).toLocaleTimeString()}.`, retryAt: cooldown.until
  };
  const message = error instanceof Error ? error.message : 'Unable to load data.';
  if (/HTTP 404/.test(message)) return { message: 'No matching record was found on the drafter site.' };
  if (/HTTP 40[13]/.test(message)) return { message: 'This information is not publicly available from the drafter site.' };
  if (/fetch|network|HTTP 5/i.test(message)) return { message: 'Could not reach the drafter API. Please try again.' };
  return { message };
}

export function registerExplorerService(ready: () => Promise<void>): void {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== EXPLORER_PORT) return;
    // Only our extension page may request lookups; content scripts cannot use this channel.
    if (port.sender?.id !== browser.runtime.id || port.sender?.url?.split(/[?#]/)[0] !== browser.runtime.getURL('/scout.html')) {
      port.disconnect(); return;
    }
    const controller = new AbortController();
    let started = false;
    const send = (reply: ExplorerReply) => {
      if (controller.signal.aborted) return;
      try { port.postMessage(reply); } catch { controller.abort(); }
    };
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener((value: unknown) => {
      if (started) return;
      started = true;
      void ready().then(async () => {
        const result = await executeExplorerRequest(validateExplorerRequest(value), controller.signal,
          profiles => send({ type: 'progress', profiles }));
        send({ type: 'result', data: result });
      }).catch(error => send({ type: 'error', ...explorerError(error) }));
    });
  });
}
