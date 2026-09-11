import type { PrematchPlayer, PrematchRoster } from '@umalytics/shared';

/** An unnumbered starting room is identified by its visible team slots, never by
 * guessing a Discord ID from a name or accepting an unrelated room's payload. */
export function matchesVisibleTeamSlots(synced: PrematchRoster, visible: PrematchRoster): boolean {
  if (synced.matchCode !== undefined || visible.matchCode !== undefined) return false;
  if (synced.players.length === 0 || synced.players.length !== visible.players.length) return false;
  const unmatched = [...synced.players];
  for (const player of visible.players) {
    const index = unmatched.findIndex(candidate => candidate.team === player.team && sameVisibleIdentity(candidate, player));
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return unmatched.length === 0;
}

function sameVisibleIdentity(candidate: PrematchPlayer, visible: PrematchPlayer): boolean {
  if (/^\d{16,20}$/.test(visible.discordId)) return candidate.discordId === visible.discordId;
  return candidate.displayName.normalize('NFC').trim() === visible.displayName.normalize('NFC').trim();
}

export function canReuseSyncedRoster(synced: PrematchRoster, visible: PrematchRoster): boolean {
  if (synced.matchCode === undefined) return matchesVisibleTeamSlots(synced, visible);
  if (synced.matchCode !== visible.matchCode) return false;
  if (synced.phase !== 'lobby' && synced.phase !== 'room-lobby') return true;
  return matchesVisibleTeamSlots({ ...synced, matchCode: undefined }, { ...visible, matchCode: undefined });
}
