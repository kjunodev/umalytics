# Validation for 0.4.1

## History and profile lookup release checks

The updated public suite passes 115 tests, including a transport test file with 14 internal checks. New cases cover code/URL validation, exact-ID lookup, duplicate names, directory pagination, completed-match mapping, unsupported saved formats, cancellation, cache scope, privacy changes and partial API failures. The completed-match fixture is a reduced public response for TG7YT2, retaining only the data needed to test the adapter.

Shared and extension TypeScript checks and production Chromium/Firefox builds pass. Public bundle verification continues to require the player-history endpoint to be absent. These local results do not claim a CI run.

The compiled public scouting UI was exercised in an in-app browser with a local browser-API/network fixture: load history without a live lobby; search and open a single player; show a private-stat response; preserve history across mode switches; receive a new live roster while History remains selected; switch to Live and see that roster. The real public match and directory-search endpoints were separately read to verify response contracts. The fixture browser check is not an installed-extension end-to-end test or a Firefox live-session test.

Version 0.4.1 packages require loading the new extension folder/package and reopening the scouting window; refresh the drafter tab for normal live scouting.

The regression suite covers request pacing/cancellation/recovery, scope-specific loading, cache retention and privacy, verified player identities, team membership, event versions/order, room switches, confirmed picks/undo, map numbering, diagnostic sanitization and refresh timing.

The public source is checked independently of the internal build. Its tests require no history requests even when the test harness supplies a private-mode flag. Production configuration rejects that flag, and the public build verifier checks that the history endpoint is absent from compiled output.

Run pnpm test, pnpm typecheck and pnpm build:all. The 0.3.9 release preparation passed the regression suite, shared/extension TypeScript checks and public Chromium/Firefox builds. See the committed tests for executable cases. CI repeats these checks; local results do not imply CI has already run successfully.

The preceding 0.3.4 candidate was observed in an installed Chromium extension during a ranked draft: ten player profiles stayed visible, new picks synchronized, and a pick moved to the vetoed list correctly. That observation exposed the refresh-label and map-order issues addressed here.

Fixtures and mocked network/browser dependencies are used for automated tests. Repeated presence messages simulate the disappearance scenario; this is not a real 30-minute soak test. The current package has not completed an installed Firefox live-draft test. Firefox is built for temporary installation and retains its store data-declaration warning.

For normal-play reports, record the browser/version, extension version, whether the issue occurred in a starting room or draft, expected and actual behavior, and diagnostics copied promptly afterward. Review diagnostics before sharing. No special arranged beta lobby is required.

The 0.3.9 suite includes 75 public tests covering companion/nickname identity, early room-event capture and replay, delayed room codes, empty initial assignment snapshots, and false captain-only DOM rosters. The final installed package still needs live long-duration verification.

### Shared explorer layout regression checks

The five tests in tests/explorer-scenes.test.mjs cover historical scene routing, roster cards, details, scoped styling, and portrait parity. Browser fixture evaluation at 1280x900 and 390x844 confirmed identical header, navigation, and scope-control rectangles across modes. History Lobby returns from player details; the catalog retained an internal scroll area (500px visible, 8774px content at desktop). Switching Profiles to All-time left History on Season. These are fixture-based UI checks, not an installed-extension session against a live lobby.

### Recent Matches regression checks

`tests/recent-history.test.mjs` exercises the real Details component and RecentMatchesList with scoped fixtures after snapshot normalization. It covers cache and lookup merges, partial/error updates, confirmed empty responses, privacy denial across scopes, season changes, and the existing five-match display limit. Unknown Uma labels do not remove match links. The public API still makes no history requests; its source and production bundle privacy checks remain mandatory.

For local validation, run `pnpm test`, `pnpm typecheck`, and `pnpm build:all` with Node 24 and pnpm 9.15.4. Use `pnpm dev` for WXT's Chromium development output under `apps/extension/.output/chrome-mv3-dev`; Firefox can load the production `apps/extension/.output/firefox-mv3/manifest.json` as a temporary add-on. Select a player, open Details, switch Season/All-time, and refresh while viewing Recent Matches. An unavailable history response must not be described as zero matches. Automated fixtures do not substitute for an installed-extension live API session.

### Release publication checks

Thirteen release tests cover public-only assets, draft-before-publish ordering, upload failures, API failures, mismatched existing tags/drafts, and incomplete published assets. The main-only release workflow reruns tests, types and public builds before attaching Chromium/Firefox ZIPs and SHA256SUMS.txt. Existing published versions are not overwritten.
