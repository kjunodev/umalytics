# Changelog

## 0.3.9 Open Beta — changes since 0.3.5

- Improve companion-avatar and nickname handling by capturing room events at document start, before the site's realtime connection is created.
- Replay captured, sanitized room events when the extension reconnects or the room code first appears; never reuse events from another room.
- Keep verified room-event identities when avatar-only DOM rows or nickname updates disagree. Apply room nickname maps without changing player IDs.
- Prevent empty initial assignment/ranked snapshots from erasing custom-room membership. Continue processing genuine departures and team moves.
- Fix the captains-only disappearance: draft summary panels can no longer masquerade as waiting-room rosters or turn draft instructions into team names.
- Retain room identity when the lobby header disappears during draft on the same page, while resetting that fallback on navigation.
- Prefer trainer-card accessibility names over companion labels/avatar initials and tighten legacy player-row boundaries.
- Public privacy behavior is unchanged: private detailed stats remain private, with no match-history reconstruction.


## 0.3.5 Open Beta

- Fix trainer identity extraction in starting rooms, including companion-image confusion and hyphenated room codes.
- Process typed room events with room/version checks, team-scoped membership updates and serialized acknowledgments. Presence-only updates no longer replace confirmed draft membership.
- Reuse bounded profile caches across lobbies; cancel obsolete work and request the selected stats scope. A ten-player cold fixture needs 22 requests instead of 32 when one scope is selected.
- Preserve useful data through API failures, respect Retry-After and limit automatic retries.
- Use actual selected-scope check times for the status label. Manual refresh cooldown survives background restart and is not restarted by draft activity. Unchanged warm rosters skip redundant profile publications.
- Match the drafter's combined map numbering, preserve map identities and show distance units on the tiebreaker.
- Distinguish unknown, private and unavailable stats from no recorded games.
- Add a bounded local diagnostic trace and regression coverage.
- Remove site-storage scanning. Public source cannot enable private-history retrieval/reconstruction.

This release continues the public open beta. See TESTING.md for validation and remaining limitations. The 0.3.0 downloads remain available unchanged for rollback.
