import type { UiServices } from '@umalytics/ui';
import { loadHistoricalMatch, loadExplorerProfiles, loadSeasonLeaderboard, searchPlayers } from '../explorer/explorerClient';
import { cancelPlayerHistoryPageRequest, cancelPlayerProfileRequest, sendPlayerHistoryPageRequest, sendPlayerProfileRequest } from '../runtime/messaging';
import { getRecentPlayers, setRecentPlayers } from '../storage/playersRecentStorage';

export const extensionUiServices: UiServices = {
  loadHistoricalMatch,
  loadExplorerProfiles,
  loadSeasonLeaderboard,
  searchPlayers,
  cancelPlayerHistoryPageRequest,
  cancelPlayerProfileRequest,
  sendPlayerHistoryPageRequest,
  sendPlayerProfileRequest,
  getRecentPlayers,
  setRecentPlayers
};
