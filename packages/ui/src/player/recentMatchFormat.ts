import type { PlayerRecentMatchSummary } from '@umalytics/shared';

export function getRecentResultTone(match: PlayerRecentMatchSummary): string {
  if (!['confirmed', 'corrected', 'reported'].includes(match.verificationState)) {
    return 'pending';
  }

  if (match.isWinner === true) {
    return 'win';
  }

  if (match.isWinner === false) {
    return 'loss';
  }

  return 'pending';
}

export function formatRecentResult(match: PlayerRecentMatchSummary): string {
  if (!['confirmed', 'corrected', 'reported'].includes(match.verificationState)) {
    return 'Pending';
  }

  if (match.isWinner === true) {
    return 'W';
  }

  if (match.isWinner === false) {
    return 'L';
  }

  return 'Unknown';
}
