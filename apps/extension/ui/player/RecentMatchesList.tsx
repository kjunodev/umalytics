import type { PlayerProfileSummary, PlayerRecentMatchSummary } from '@umalytics/shared';

export function RecentMatchesList({
  recentMatches,
  playerName,
  emptyMessage,
  total,
  loading,
  error,
  onLoadMore
}: {
  recentMatches?: PlayerProfileSummary['recentMatches'];
  playerName: string;
  emptyMessage?: string;
  total?: number;
  loading?: boolean;
  error?: string;
  onLoadMore?: () => void;
}) {
  const matches = recentMatches ?? [];

  return (
    <section
      className="recent-matches"
      aria-label={`${playerName} recent ranked matches`}
      title="Ranked match history for the selected stat scope."
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
                {match.eloDelta !== null && match.eloDelta !== undefined ? ` · ${match.eloDelta >= 0 ? '+' : ''}${match.eloDelta} rating` :
                  match.eloPlacement === true ? ' · placement' : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
      {matches.length > 0 && error ? <span className="section-message">{error}</span> : null}
      {onLoadMore && total !== undefined && matches.length < total ? (
        <button type="button" disabled={loading} onClick={onLoadMore}>Load more</button>
      ) : null}
    </section>
  );
}

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
