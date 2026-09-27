import type { EsportsTeamIcon } from '@umalytics/shared';

// Small, consistent team-logo badge shared by the lobby card, the player
// drawer header and the Players leaderboard rows. Callers guard for a
// missing team the same way they already guard <CaptainCrown />: render
// nothing rather than passing an optional icon in here.
// The tooltip box itself carries no position (top/bottom/left/right): each
// call site's CSS anchors it to that context's own row, following the same
// "anchored to the row, not the trigger" pattern as .chip-tooltip.
export function TeamIcon({ icon }: { icon: EsportsTeamIcon }) {
  return (
    <span className="team-icon" tabIndex={0}>
      <img src={icon.logoUrl} alt="" />
      <span className="team-icon-tooltip" role="tooltip">{`Uma League · ${icon.teamName}`}</span>
    </span>
  );
}
