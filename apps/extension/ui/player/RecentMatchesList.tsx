import type { PlayerProfileSummary, PlayerRecentMatchSummary } from '@umalytics/shared';
import { RECENT_HISTORY_DISPLAY_MATCHES } from '../../profiles/profileConstants';

export function RecentMatchesList({
  recentMatches,
  playerName,
  emptyMessage
}: {
  recentMatches?: PlayerProfileSummary['recentMatches'];
  playerName: string;
  emptyMessage?: string;
}) {
  const matches = recentMatches?.slice(0, RECENT_HISTORY_DISPLAY_MATCHES) ?? [];

  return (
    <section
      className="recent-matches"
      aria-label={`${playerName} recent ranked matches`}
      title={`Last ${RECENT_HISTORY_DISPLAY_MATCHES} ranked match-history entries for the selected stat scope.`}
    >
      <p>Recent Matches</p>
      {matches.length === 0 ? (
        <span className="section-message">{emptyMessage ?? 'No recent match history found.'}</span>
      ) : (
        <ol>
          {matches.map((match) => (
            <li key={match.matchId}>
              <span className={`recent-result ${getRecentResultTone(match)}`}>
                {formatRecentResult(match)}
              </span>
              <a
                href={`https://drafter.uma.guide/matches/${encodeURIComponent(match.matchId)}`}
                target="_blank"
                rel="noreferrer"
                className="recent-match-code"
                title="Open match history"
              >
                {match.matchId}
              </a>
              <span className="recent-uma" title={match.umaName}>{match.umaName}</span>
              <span className="recent-points">
                {match.pointsScored} pts{match.isMvp ? ' - MVP' : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function getRecentResultTone(match: PlayerRecentMatchSummary): string {
  if (match.verificationState !== 'confirmed') {
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
  if (match.verificationState !== 'confirmed') {
    return 'Pending';
  }

  if (match.isWinner === true) {
    return 'W';
  }

  if (match.isWinner === false) {
    return 'L';
  }

  return '-';
}
