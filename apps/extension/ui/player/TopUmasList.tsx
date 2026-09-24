import type { PlayerProfileSummary } from '@umalytics/shared';
import { formatDecimal, formatPercent } from '../common/format';

export function TopUmasList({
  topUmas,
  playerName,
  emptyMessage
}: {
  topUmas?: PlayerProfileSummary['topUmas'];
  playerName: string;
  emptyMessage?: string;
}) {
  const slots = Array.from({ length: 3 }, (_, index) => topUmas?.[index]);
  const shouldShowMessage = topUmas === undefined || topUmas.length === 0;

  return (
    <div
      className="top-umas"
      aria-label={`${playerName} most played Umas`}
      title="Most played ranked Umas for the selected stat scope."
    >
      <p>Most Played</p>
      {shouldShowMessage ? (
        <span className="section-message">{emptyMessage ?? 'No ranked Uma data found.'}</span>
      ) : (
        <ol>
          {slots.map((uma, index) => (
            uma === undefined ? (
              <li key={`empty-uma:${index}`} className="empty-uma-row">
                <span className="uma-name">-</span>
                <span className="uma-meta">-</span>
              </li>
            ) : (
              <li key={uma.umaId}>
                <span className="uma-name" title={uma.name}>
                  {uma.name}
                </span>
                <span className="uma-meta">
                  {uma.matches} GP - {formatPercent(uma.winRate)} - {formatDecimal(uma.pointsPerGame)} PPG
                </span>
              </li>
            )
          ))}
        </ol>
      )}
    </div>
  );
}

export function UmaResolutionNote({ profile }: { profile: PlayerProfileSummary | undefined }) {
  if (profile?.historyDerived) return <p className="profile-status-note">History-derived stats; limited to the available history sample (up to 100 matches per scope).</p>;
  const unresolvedUmaMatches = profile?.unresolvedUmaMatches ?? 0;
  const disqualifiedMatches = profile?.disqualifiedMatches ?? 0;
  const notes = [
    unresolvedUmaMatches > 0
      ? `${unresolvedUmaMatches} unresolved ${unresolvedUmaMatches === 1 ? 'Uma match' : 'Uma matches'}`
      : undefined,
    disqualifiedMatches > 0
      ? `${disqualifiedMatches} disqualified ${disqualifiedMatches === 1 ? 'match' : 'matches'}`
      : undefined
  ].filter((note): note is string => note !== undefined);

  if (notes.length === 0) {
    return null;
  }

  return (
    <p className="uma-resolution-note" title="These matches count toward player totals but are not scoutable Uma entries.">
      {notes.join(' - ')}
    </p>
  );
}
