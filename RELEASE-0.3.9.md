# UmaLytics 0.3.9 Open Beta

## 0.3.9 Open Beta — changes since 0.3.5

- Improve companion-avatar and nickname handling by capturing room events at document start, before the site's realtime connection is created.
- Replay captured, sanitized room events when the extension reconnects or the room code first appears; never reuse events from another room.
- Keep verified room-event identities when avatar-only DOM rows or nickname updates disagree. Apply room nickname maps without changing player IDs.
- Prevent empty initial assignment/ranked snapshots from erasing custom-room membership. Continue processing genuine departures and team moves.
- Fix the captains-only disappearance: draft summary panels can no longer masquerade as waiting-room rosters or turn draft instructions into team names.
- Retain room identity when the lobby header disappears during draft on the same page, while resetting that fallback on navigation.
- Prefer trainer-card accessibility names over companion labels/avatar initials and tighten legacy player-row boundaries.
- Public privacy behavior is unchanged: private detailed stats remain private, with no match-history reconstruction.

## Updating

Download and extract the appropriate public ZIP, reload the extension, then refresh every open drafter tab once. The version remains 0.3.9.

## Validation and limits

75 public tests passed (149 across the separate public/private suites), TypeScript checks passed, and both public browser builds passed. Compiled event capture/replay was checked for all four build variants, and the supplied pre-lobby HTML still parses ten players. These are automated checks, not a completed live soak of the final installed build. API rate limits still apply; Firefox ZIPs remain unsigned temporary add-ons.
