import { createContext, useContext, type ReactNode } from 'react';
import type { PlayerProfileSummary, PlayerRecentMatchSummary, PlayerStatsScope, PrematchPlayer } from '@umalytics/shared';
import type { HistoricalMatch, PlayerSearchResult } from '@umalytics/core/explorer/explorerTypes';
import type { SeasonLeaderboard } from '@umalytics/core/profiles/playerProfileApi';

export interface RecentPlayerEntry {
  discordId: string;
  displayName: string;
}

export interface PlayerHistoryPage {
  page: number;
  total: number;
  matches: PlayerRecentMatchSummary[];
  summary?: PlayerProfileSummary['historySummary'];
}

/** Host-provided transport and storage; request identities and signals pass through unchanged. */
export interface UiServices {
  loadHistoricalMatch(input: string, signal: AbortSignal): Promise<HistoricalMatch>;
  loadExplorerProfiles(players: PrematchPlayer[], scope: PlayerStatsScope,
    onProgress: (profiles: Record<string, PlayerProfileSummary>) => void,
    signal: AbortSignal): Promise<Record<string, PlayerProfileSummary>>;
  searchPlayers(input: string, page: number, signal: AbortSignal): Promise<PlayerSearchResult>;
  loadSeasonLeaderboard(signal: AbortSignal): Promise<SeasonLeaderboard>;
  sendPlayerHistoryPageRequest(discordId: string, scope: PlayerStatsScope, page: number, requestId: string): Promise<PlayerHistoryPage>;
  cancelPlayerHistoryPageRequest(requestId: string): Promise<void>;
  sendPlayerProfileRequest(discordId: string, requestId: string): Promise<{ title: string | null }>;
  cancelPlayerProfileRequest(requestId: string): Promise<void>;
  getRecentPlayers(): Promise<RecentPlayerEntry[]>;
  setRecentPlayers(recent: RecentPlayerEntry[]): Promise<void>;
}

const UiServicesContext = createContext<UiServices | undefined>(undefined);

export function UiServicesProvider({ services, children }: { services: UiServices; children: ReactNode }) {
  return <UiServicesContext.Provider value={services}>{children}</UiServicesContext.Provider>;
}

export function useUiServices(): UiServices {
  const services = useContext(UiServicesContext);
  if (services === undefined) throw new Error('UiServicesProvider is required.');
  return services;
}
