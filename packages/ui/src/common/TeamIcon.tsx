import { useRef } from 'react';
import type { EsportsTeamIcon } from '@umalytics/shared';
import { positionTeamIconTooltip } from './tooltipPlacement';

// Small, consistent team-logo badge shared by the lobby card, the player
// drawer header and the Players leaderboard rows. Callers guard for a
// missing team the same way they already guard <CaptainCrown />: render
// nothing rather than passing an optional icon in here.
// The tooltip is anchored to the icon itself (not its row, unlike
// .chip-tooltip): it is as wide as its text, and on hover/focus it is placed
// below the icon, above it, or beside it, whichever keeps it inside the
// card, row or drawer the icon sits in. See tooltipPlacement.ts.
export function TeamIcon({ icon }: { icon: EsportsTeamIcon }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const place = () => {
    if (iconRef.current !== null && tooltipRef.current !== null) positionTeamIconTooltip(iconRef.current, tooltipRef.current);
  };
  return (
    <span ref={iconRef} className="team-icon" tabIndex={0} onMouseEnter={place} onFocus={place}>
      <img src={icon.logoUrl} alt="" />
      <span ref={tooltipRef} className="team-icon-tooltip" role="tooltip">{`Uma League · ${icon.teamName}`}</span>
    </span>
  );
}
