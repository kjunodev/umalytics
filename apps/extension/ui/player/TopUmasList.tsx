import type { PlayerProfileSummary } from '@umalytics/shared';
import { formatDecimal, formatPercent } from '../common/format';

// The card shows up to this many Umas; how many actually render is decided
// purely by CSS (see .top-umas-rows in base.css), which reveals only whole
// rows that fit the card's remaining height.
export const MAX_TOP_UMAS = 5;

export function TopUmasList({
  topUmas,
  playerName,
  emptyMessage
}: {
  topUmas?: PlayerProfileSummary['topUmas'];
  playerName: string;
  emptyMessage?: string;
}) {
  const slots = Array.from({ length: MAX_TOP_UMAS }, (_, index) => topUmas?.[index]);
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
        <ol className="top-umas-rows">
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
  if (profile?.historyDerived) return null;
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
