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

Generated bundles live in apps/extension/.output. Checked build snapshots live in .releases; latest.json describes the latest pair. This repository supports public builds only. The build configuration rejects a private-mode environment flag, and the API source contains no private-history retrieval or reconstruction implementation.

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

## Release checks

CI runs regression tests, type checks and the public build pair with read-only repository permissions. It does not upload private artifacts or publish releases. Before changing download links, build and verify the exact public ZIPs; preserve older versioned assets. Update README, INSTALL, CHANGELOG and TESTING together. Beta release objects, if created later, should be marked as pre-releases.

Manual validation remains necessary for room-to-draft transitions, reconnects, room changes, long sessions and Firefox. Automated tests use fixtures/mocked browser and network dependencies; passing them is not a live latency guarantee.

Firefox currently emits a data-collection declaration warning. Permanent/store distribution requires an accurate declaration and signing work; do not suppress the warning and describe the result as store-ready.

## Working across machines

Before edits, check git status and pull the latest source. Commit only source, tests, documentation and intentionally versioned public downloads. Do not commit local caches, diagnostics, credentials, generated development folders or unrelated workspace files. Build from the same commit on both machines.
