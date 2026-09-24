import type { PlayerProfileSummary } from '@umalytics/shared';

export type PlayerProfileLoadStatus = 'queued' | 'loading' | 'loaded' | 'private' | 'timeout' | 'error';

export interface PlayerProfileLoadState {
  discordId: string;
  status: PlayerProfileLoadStatus;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
  error?: string;
  stage?: string;
  retryAt?: number;
}

export interface PlayerProfileSummariesSnapshot {
  buildMode?: 'private' | 'public';
  matchCode?: string;
  runId?: number;
  startedAt?: number;
  manualRefreshAt?: number;
  profiles: Record<string, PlayerProfileSummary>;
  profileStates?: Record<string, PlayerProfileLoadState>;
  loadingDiscordIds: string[];
  updatedAt: number;
}
