# UmaLytics public build: data handling

Updated for the per-player scouting flow.

Development update: History requests a public completed match by the code you submit. Profiles searches the public player directory using the name you submit, or looks up the exact ID from your input/profile URL. These requests omit browser credentials and use the same API pacing and cache as live scouting. Match and search selections remain in window memory, separate from the live roster; fetched profile summaries may enter the existing bounded profile archive.

UmaLytics is a browser extension for Uma Drafter. It observes room/team membership and confirmed draft state on drafter.uma.guide. For a lobby, it makes paced per-player statistics requests for the selected Season or All-time scope, plus a seasons request and a leaderboard request; names come from the room roster, so lobby cards make no profile request. The public build makes no batch request during lobby loading. Requests contain the player identifiers required by those endpoints. API fetches omit browser credentials. Refer to Uma Drafter for its own service practices.

Opening a player's details requests that player's profile once, for their title, and the first page of their public ranked match history; Load more requests subsequent history pages. This also works when that player's statistics are hidden. The profile response is cached for 24 hours. Recent results and form appear in details from the first history page, not on lobby cards. The public build displays history but never derives wins, losses, win rate, points per game, MVP totals or Uma statistics from it. Public identity, rank or rating can be displayed independently of hidden detailed statistics.

## Local storage

The extension stores current roster/draft snapshots, cached player summaries, scope/lock preferences and recovery state in local extension storage. Its reusable profile archive holds at most 100 profiles, approximately 4 MiB, and removes archive entries older than 24 hours when the cache is processed. Current snapshots and preferences can remain until replaced or the extension's storage is cleared. These are not guarantees of automatic deletion while the extension is inactive.

A diagnostic trace retains up to 200 sanitized event/request summaries locally. It excludes raw packets, chat, credentials, player names and player IDs. Room codes, team counts, versions, endpoint categories, timings and HTTP statuses may be present. The page hook does not scan site localStorage/sessionStorage.

## Sharing and deletion

UmaLytics has no separate backend, analytics service or automatic diagnostic upload. Copy diagnostics writes a report to your clipboard at your request. The existing status section may include player IDs and API paths, so review the whole report before posting it to a public issue. Posting diagnostics is your choice.

Remove the extension or clear its extension storage through your browser to remove locally retained data. Copies you export or post elsewhere are outside extension storage. The supported sites can receive normal network metadata when requests or image loads reach them.

Questions can be raised in the community repository's issues. Do not include credentials or private personal information in a public issue.
