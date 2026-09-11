# Changelog

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
