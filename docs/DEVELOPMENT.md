# Developing UmaLytics

Use Node.js 24 and pnpm 9.15.4 (pinned in package.json). No database, backend, API key or environment file is needed.

~~~sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build:all
~~~

The extension's postinstall/typecheck prepares WXT generated types. Keep separate dependencies on each machine and use the committed lockfile. The regression runner uses Node 24's TypeScript stripping API.

## Commands

| Command | Purpose |
| --- | --- |
| pnpm dev | WXT Chromium development session |
| pnpm test | API, room-state, cache, cancellation, privacy and timing regressions |
| pnpm typecheck | Shared and extension TypeScript checks |
| pnpm build | Public Chromium build |
| pnpm build:all | Public Chromium and Firefox builds with manifest/privacy checks |

Generated bundles live in apps/extension/.output. Checked build snapshots live in .releases; latest.json describes the latest pair. This repository supports public builds only. The build configuration rejects a private-mode environment flag. Public history pages may be fetched and displayed, but public statistics must never be calculated from them.

## Architecture

| Component | Responsibility |
| --- | --- |
| Page hook | Decode supported room events; forward whitelisted fields; retain a specific sync-console fallback |
| Content script | Establish visible room identity, serialize updates, reject old/foreign events, and apply DOM fallback |
| Room event reducer | Separate presence from authoritative membership; track snapshot versions and team revisions |
| Background | Follow the active drafter tab, cancel obsolete work, pace requests, recover from rate limits and manage caches |
| Scout | Render local snapshots, selected-scope statistics and confirmed draft selections |
| Shared package | TypeScript contracts across extension contexts |

Fresh complete profiles are reused for 15 minutes. The reusable archive is bounded to 100 profiles and approximately 4 MiB, and trims entries older than 24 hours when processed. The local diagnostic trace is capped at 200 sanitized entries. These limits apply to the archive/trace, not every byte of extension storage.

Lobby enrichment uses paced per-player stats requests for the selected Season or All-time scope, plus a seasons request and a leaderboard request scheduled at a lower priority so every stats request starts first; switching scope loads the other stats scope. Lobby cards make no profile request and show no title, since names come from the roster. The public build makes no batch request during lobby loading. The batch client, response mapper, roster settling, and budget helpers remain available for private integration. Opening a player's details requests that player's profile once, at 'profile' priority, for their title; the response is cached for 24 hours and the request is cancelled if details close first. A title already present on the profile summary (for example from a batch response) is used without a request. Opening details also requests a 20-entry public history page, including for hidden-stats players; the first page supplies recent results and form, and Load more fetches another page. No other view starts history paging. History responses are cached for five minutes and never feed the public statistics mapper.

Requests are paced by `DEFAULT_REQUEST_INTERVAL_MS` (500 ms in the public build). A 429 doubles the pacing interval, capped at 2000 ms; once doubled, every 20 consecutive successful requests step the interval back toward the base by ×0.75, never below it. `setBaseRequestInterval(ms)`, bounded to at least 250 ms, lets a build choose a different base pace without editing the constant; the public build never calls it.

## Release checks

The release workflow (`.github/workflows/release.yml`) publishes automatically: on a push to `main` in `skimuic/UmaLytics` that changes `package.json` or `scripts/publish-release.mjs`, it reruns `pnpm test`, `pnpm typecheck` and `pnpm build:all`, then packages and uploads the public Chromium/Firefox ZIPs and `SHA256SUMS.txt` to a GitHub release for that version. It never runs against the mirror repository. Before changing download links, build and verify the exact public ZIPs; preserve older versioned assets. Update README, docs/INSTALL.md and CHANGELOG together. Beta release objects, if created later, should be marked as pre-releases.

Firefox currently emits a data-collection declaration warning. Permanent/store distribution requires an accurate declaration and signing work; do not suppress the warning and describe the result as store-ready.

## Manual checks

Automated tests use fixtures and mocked browser/network dependencies; passing them is not a live-session guarantee. Before a release, manually verify with an installed extension against a live lobby:

- **Room-to-draft transitions** — confirm the roster and picks carry over correctly when a room moves into a draft, and that stale room state doesn't leak into the new draft.
- **Reconnects** — close and reopen the scouting window (or reload the tab) mid-room/mid-draft and confirm state resumes without duplicate or missing entries.
- **Room changes** — switch rooms and confirm caches and displayed roster reset to the new room instead of showing stale data.
- **Long sessions** — automated fixtures do not run a real soak test; manually leave a session open for an extended period and confirm requests keep pacing/recovering correctly and the diagnostic trace stays bounded.
- **Firefox** — load the production build (`apps/extension/.output/firefox-mv3/manifest.json`) as a temporary add-on; there is no installed Firefox live-draft test in CI, so this needs manual coverage each release.

When filing a bug report, include: browser and version, extension version, whether the issue occurred in a starting room or in a draft, expected vs. actual behavior, and diagnostics copied promptly after reproducing (review diagnostics before sharing — they can contain room codes and player IDs). No special arranged beta lobby is required.

## Working across machines

Before edits, check git status and pull the latest source. Commit only source, tests and documentation. Do not commit local caches, diagnostics, credentials, generated development folders or unrelated workspace files. Build from the same commit on both machines.
