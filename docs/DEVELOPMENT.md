# Developing UmaLytics

Use Node.js 24 and pnpm 9.15.4 (pinned in package.json). No database, backend, API key or environment file is needed.

~~~sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build:all
~~~

The extension's postinstall/typecheck prepares WXT generated types. Keep separate dependencies on each machine and use the committed lockfile.

## Commands

| Command | Purpose |
| --- | --- |
| pnpm dev | WXT Chromium development session |
| pnpm test | API, room-state, cache, cancellation, privacy and timing regressions |
| pnpm typecheck | Shared and extension TypeScript checks |
| pnpm build | Chromium build |
| pnpm build:all | Chromium and Firefox builds with manifest and history-display checks |
| pnpm --filter @umalytics/extension preview | Layout preview harness (static fixtures, no live lobby); see apps/extension/dev/preview/README.md |
| pnpm --filter @umalytics/extension preview:shots | Screenshots and layout checks for every scene, viewport and UI size |

## Tests

`pnpm test` runs every `tests/*.test.mjs` file with the Node test runner, one file per area:

| Area | Files |
| --- | --- |
| Profile API | `profile-api`, `request-pacing`, `profile-cache`, `profile-recovery`, `team-icons` |
| Background | `background-enrichment`, `scout-window`, `diagnostic-recorder` |
| Room and content | `room-events`, `roster-extraction`, `dom-extraction`, `content-script`, `page-hook`, `casual-room-replay` |
| History and players | `explorer`, `explorer-scenes`, `explorer-transport`, `recent-history`, `history-display-rules`, `players-data` |
| UI | `lobby-cards`, `draft-scene`, `uma-data`, `uma-experience`, `profile-usability`, `podium-badge`, `ui-size`, `ui-polish-0-5-1` |
| Release | `release` (the publish script) |

Tests load extension sources through `tests/support/harness.mjs`, which strips imports and exports and evaluates the TypeScript (Node 24 type stripping) in a `vm` context. Its `MODULES` map names every source file the suite loads, and `PRELOADS` lists the modules each one needs first, so a moved or split file only changes the map. `playerProfileApi` is listed as three files (`profiles/apiClient.ts`, `profiles/profileApiMapping.ts`, `profiles/playerProfileApi.ts`) that are evaluated together. `tests/support/helpers.mjs` holds the shared API, background, room, DOM and content harnesses; `tests/fixtures/` holds recorded JSON.

Generated bundles live in apps/extension/.output. Checked build snapshots live in .releases; latest.json describes the latest pair. There is one extension build for each browser. Match history can be fetched and displayed, including for players with hidden stats, but never used to calculate ranked statistics.

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

Lobby enrichment uses paced per-player stats requests for the selected Season or All-time scope, plus seasons and leaderboard requests. Switching scope loads the other stats scope. Lobby cards make no profile or history request. Opening details requests the player's profile for their title and a 20-entry history page, including for hidden-stats players. Load more fetches additional pages. History responses are cached for five minutes and never feed the statistics mapper.

Requests start at least 350 ms apart. A 429 doubles the pacing interval, capped at 2000 ms; after 20 consecutive successes it recovers toward 350 ms by ×0.75, never below the base.

## Release checks

The release workflow (`.github/workflows/release.yml`) publishes automatically: on a push to `main` in either `skimuic/UmaLytics` or `kjunodev/umalytics` that changes `package.json` or `scripts/publish-release.mjs`, it reruns `pnpm test`, `pnpm typecheck` and `pnpm build:all`, then packages and uploads the Chromium/Firefox ZIPs and `SHA256SUMS.txt` to a GitHub release in that repository for that version. Other repositories cannot publish through this workflow. Before changing download links, build and verify the exact ZIPs; preserve older versioned assets. Update README, docs/INSTALL.md and CHANGELOG together. Candidate release objects, if created later, should be marked as pre-releases.

Firefox currently emits a data-collection declaration warning. Permanent/store distribution requires an accurate declaration and signing work; do not suppress the warning and describe the result as store-ready.

For local candidate or release archives, run `pnpm package:release`. It reads `version` and `version_name` from `apps/extension/wxt.config.ts`, builds with `pnpm build:all`, and zips the Chromium and Firefox outputs to `downloads/<version>/<version_name>/umalytics-<browser>-<version_name>.zip`. It refuses existing output names, verifies every archive entry against its build folder by SHA-256, and writes `SHA256SUMS.txt` alongside the ZIPs. It does not publish anything.

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
