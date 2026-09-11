# UmaLytics public build: data handling

Updated for 0.3.5.

UmaLytics is a browser extension for Uma Drafter. It observes room/team membership and confirmed draft state on drafter.uma.guide, then requests available player profiles, ranked statistics, seasons and leaderboard information from drafter-api.uma.guide. Requests contain the player identifiers required by those endpoints. API fetches omit browser credentials. Refer to Uma Drafter for its own service practices.

The public source does not retrieve player match history or reconstruct private ranked statistics. Public identity, rank or rating can be displayed independently of hidden detailed statistics.

## Local storage

The extension stores current roster/draft snapshots, cached player summaries, scope/lock preferences and recovery state in local extension storage. Its reusable profile archive holds at most 100 profiles, approximately 4 MiB, and removes archive entries older than 24 hours when the cache is processed. Current snapshots and preferences can remain until replaced or the extension's storage is cleared. These are not guarantees of automatic deletion while the extension is inactive.

A diagnostic trace retains up to 200 sanitized event/request summaries locally. It excludes raw packets, chat, credentials, player names and player IDs. Room codes, team counts, versions, endpoint categories, timings and HTTP statuses may be present. The page hook does not scan site localStorage/sessionStorage.

## Sharing and deletion

UmaLytics has no separate backend, analytics service or automatic diagnostic upload. Copy diagnostics writes a report to your clipboard at your request. The existing status section may include player IDs and API paths, so review the whole report before posting it to a public issue. Posting diagnostics is your choice.

Remove the extension or clear its extension storage through your browser to remove locally retained data. Copies you export or post elsewhere are outside extension storage. The supported sites can receive normal network metadata when requests or image loads reach them.

Questions can be raised in the community repository's issues. Do not include credentials or private personal information in a public issue.
