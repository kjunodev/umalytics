# Changelog

## 0.5.1

- Keep every player visible when they join or rejoin long-lived casual rooms. Never show internal IDs as names; show "Profile unavailable" for players without a Discord account.
- Open a match in History by clicking its code in a player's match history, with a link to Uma Drafter.
- Show the season name on the Players page and use consistent ratings throughout UmaLytics.
- Keep team-icon tooltips from covering other rows or cards.
- Keep long W-L records from stretching lobby cards.
- Align Draft columns and keep race conditions on one line.
- Include an anonymous room-event summary in Copy diagnostics for bug reports.

## 0.5.0

- Redesign the scouting window with a slim header: Live / History / Players, Lobby / Draft / Umas scenes and Season / All-time.
- Redesign lobby cards with a rank chip, badges (One-trick, Deep pool, Podium regular, Underrated, Newcomer), four core stats and each player's top three Umas. Player details open in a side drawer with title, a sortable Uma table and paged match history.
- Show Uma League team icons on lobby cards, in the player drawer and on the Players page.
- Rebuild Draft as team / races / team columns with a phase bar, race cards (track, distance and conditions), pick experience and ban/veto rows.
- Redesign Umas as a searchable, sortable catalog with lobby and per-team experience.
- Replace single-profile lookup with Players: search the season leaderboard or open a profile by URL or Discord ID. History shows completed matches in the same scenes and drawer.
- Add a UI size setting (Small / Default / Large) in the header menu. The scouting window remembers its size and position.
- Space API requests at least 350 ms apart (previously 500 ms), with the same rate-limit backoff.
- Display match history in player details, including for players with hidden stats; it is never used to calculate ranked statistics.

## 0.4.1

- Correct Recent Matches status in player Details: unavailable or private history is no longer described as a successful empty result.
- Preserve already-loaded scoped profile data when switching Season / All-time and during partial refreshes or request failures.
- Clear stale history after a confirmed privacy denial and prevent history from leaking between players or seasons.
- Continue to respect hidden ranked stats without reconstructing them from match history.
- Publish downloadable browser releases on skimuic/UmaLytics; kjunodev/umalytics mirrors the same source without publishing releases.

## 0.4.0

- Add Live / History / Profiles navigation while preserving the live lobby independently.
- Load a completed draft by match code or match URL using the same draft layout, including final picks, bans, vetoed maps and the tiebreaker.
- Add single-player lookup by name, Discord ID or profile URL, with selectable search results and Season / All-time details.
- Share API pacing and profile caches with live scouting; cancel replaced lookups and preserve available stats through partial failures.
- Respect hidden ranked stats in lookup. Historical match selections are labeled separately from current player statistics.

- Keep navigation and header sizing stable across Live, History and Profiles.
- Add Lobby / Draft / Umas scenes to completed matches, including player details.
- Match picked-Uma portraits and shared button styles across modes.
- Keep the Uma catalog internally scrollable and restore Lobby navigation from History player details.

## 0.3.9 — changes since 0.3.5

- Improve companion-avatar and nickname handling by capturing room events at document start, before the site's realtime connection is created.
- Replay captured, sanitized room events when the extension reconnects or the room code first appears; never reuse events from another room.
- Keep verified room-event identities when avatar-only DOM rows or nickname updates disagree. Apply room nickname maps without changing player IDs.
- Prevent empty initial assignment/ranked snapshots from erasing custom-room membership. Continue processing genuine departures and team moves.
- Fix the captains-only disappearance: draft summary panels can no longer masquerade as waiting-room rosters or turn draft instructions into team names.
- Retain room identity when the lobby header disappears during draft on the same page, while resetting that fallback on navigation.
- Prefer trainer-card accessibility names over companion labels/avatar initials and tighten legacy player-row boundaries.
- Hidden detailed stats remain unavailable, with no match-history reconstruction.


## 0.3.5

- Fix trainer identity extraction in starting rooms, including companion-image confusion and hyphenated room codes.
- Process typed room events with room/version checks, team-scoped membership updates and serialized acknowledgments. Presence-only updates no longer replace confirmed draft membership.
- Reuse bounded profile caches across lobbies; cancel obsolete work and request the selected stats scope. A ten-player cold fixture needs 22 requests instead of 32 when one scope is selected.
- Preserve useful data through API failures, respect Retry-After and limit automatic retries.
- Use actual selected-scope check times for the status label. Manual refresh cooldown survives background restart and is not restarted by draft activity. Unchanged warm rosters skip redundant profile publications.
- Match the drafter's combined map numbering, preserve map identities and show distance units on the tiebreaker.
- Distinguish unknown, private and unavailable stats from no recorded games.
- Add a bounded local diagnostic trace and regression coverage.
- Remove site-storage scanning. Match history cannot be used to reconstruct hidden ranked statistics.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for validation and remaining limitations. The 0.3.0 downloads remain available unchanged for rollback on the [releases page](https://github.com/kjunodev/umalytics/releases).
