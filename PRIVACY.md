# UmaLytics privacy and data handling

UmaLytics is a browser extension for Uma Drafter. It reads the room you are in on drafter.uma.guide, asks Uma Drafter's public API for the statistics of the players in that room, and shows the result in its own window. It has no backend, no analytics and no automatic upload of any kind. Everything it keeps stays in your browser's extension storage until you remove it.

## What it reads on drafter.uma.guide

On drafter.uma.guide the extension observes the room code, team membership and confirmed draft state, using the page's realtime room events with a fallback to what is visible on the page. It does not read your Discord or site credentials, and it does not scan the site's localStorage or sessionStorage.

## What it requests

Requests go to drafter-api.uma.guide and include the player identifiers, seasons, match codes or search text that the endpoint needs. They omit browser credentials. Refer to Uma Drafter for its own service practices.

- **Live lobby:** one stats request per player for the scope you selected (Season or All-time), one seasons request and one leaderboard request. In Season scope, a player with fewer than 10 season games also gets one extra all-time stats request, so the Newcomer badge is accurate. Lobby cards make no profile or match-history request.
- **Opening a player's details:** one profile request (for the player's title) and the first page of that player's ranked match history. Load more requests further history pages. This also works when the player's statistics are hidden.
- **History:** the completed match for the match code or match-page URL you submit.
- **Players:** a player directory search for the name you submit, or a lookup of the exact Discord ID from the ID or profile URL you submit.
- **Team icons:** the Uma League team list, refreshed at most once every 24 hours, so lobby cards can show team icons. Icons and Uma portraits are images loaded from drafter.uma.guide.

Match history is display-only. It is never used to calculate or change statistics, badges or the Private state. Hidden statistics stay hidden. Identity, rank or rating can still appear when the site exposes them separately.

## Rate limits and retries

Requests start at least 350 ms apart, with at most three in flight. If the API answers HTTP 429 or a 5xx error, all requests pause: for the time given by its Retry-After header, otherwise 30 seconds after a 429 and 10 seconds after a 5xx. The extension then retries the affected players automatically at most 2 times. After that it stops and waits for you to press Refresh. It does not try to get around the limit.

## What is stored on your device

**Local extension storage (`storage.local`)** persists until it is replaced, the extension is removed or you clear the extension's data:

- Current room and draft snapshots (including player names and Discord IDs), the loaded player summaries, and the Lobby Lock state.
- Preferences: the selected stats scope and the UI size.
- A profile archive that lets a later lobby reuse recent results: at most 100 players, about 4 MiB, entries older than 24 hours dropped. It is written once per lobby run.
- Recovery state for rate-limit retries, and the time of your last manual refresh (it drives the Refresh cooldown).
- A diagnostic trace of up to 200 sanitized entries: event and request kinds, room codes, team counts, versions, endpoint categories, timings and HTTP statuses. It excludes raw packets, chat, credentials, player names and player IDs.
- Recently viewed players in the Players view: Discord ID and display name.
- The scouting window's position and size (Chromium browsers).
- The Uma League team icon list (refreshed every 24 hours).

**Session extension storage (`storage.session`)** is kept in memory by the browser and cleared when the browser closes:

- A cache of API responses so a restarted background worker does not refetch them: seasons and leaderboard for 10 minutes, player profiles for 24 hours (at most 200 players).
- The scouting window's id and the selected drafter tab's id, so both survive background service-worker restarts.

**Memory only**, lost whenever the background worker stops: match-history pages (5 minutes) and other responses such as stats, match and search lookups (60 seconds). A match or search you open in History or Players is kept in the scouting window's memory and resets when the window closes.

## Sharing and deletion

Copy diagnostics writes a report to your clipboard only when you ask. The report's status section can include player IDs, room codes and API paths, so review it before posting it to a public issue. Posting it is your choice.

To remove stored data, remove the extension or clear its data in your browser. Copies you export or post elsewhere are outside extension storage. Uma Drafter's servers receive normal network metadata when requests or image loads reach them.

Questions can be raised in the repository's issues. Do not include credentials or private personal information in a public issue.
