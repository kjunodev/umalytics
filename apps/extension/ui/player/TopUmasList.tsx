import type { PlayerProfileSummary, PlayerTopUmaSummary } from '@umalytics/shared';
import { formatDecimal, formatPercent } from '../common/format';
import { BestUmaPortrait } from './BestUmaPortrait';

// The card shows exactly this many Umas (or fewer if the player hasn't
// played that many); there is no placeholder row for a missing entry.
export const MAX_TOP_UMAS = 3;

export function sortTopUmasForCard(umas: PlayerTopUmaSummary[]): PlayerTopUmaSummary[] {
  return [...umas]
    .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name))
    .slice(0, MAX_TOP_UMAS);
}

export function TopUmasList({
  topUmas,
  allUmas,
  playerName,
  emptyMessage
}: {
  topUmas?: PlayerProfileSummary['topUmas'];
  allUmas?: PlayerProfileSummary['allUmas'];
  playerName: string;
  emptyMessage?: string;
}) {
  const source = allUmas ?? topUmas;
  const cardUmas = source === undefined ? undefined : sortTopUmasForCard(source);
  const shouldShowMessage = cardUmas === undefined || cardUmas.length === 0;

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
          {cardUmas.map((uma) => (
            <li key={uma.umaId}>
              <BestUmaPortrait uma={uma} />
              <span className="uma-name" title={uma.name}>
                {uma.name}
              </span>
              <span className="uma-meta">
                {uma.matches} GP - {formatPercent(uma.winRate)} - {formatDecimal(uma.pointsPerGame)} PPG
              </span>
            </li>
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
