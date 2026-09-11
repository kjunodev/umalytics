# Validation for 0.3.5

The regression suite covers request pacing/cancellation/recovery, scope-specific loading, cache retention and privacy, verified player identities, team membership, event versions/order, room switches, confirmed picks/undo, map numbering, diagnostic sanitization and refresh timing.

The public source is checked independently of the internal build. Its tests require no history requests even when the test harness supplies a private-mode flag. Production configuration rejects that flag, and the public build verifier checks that the history endpoint is absent from compiled output.

Run pnpm test, pnpm typecheck and pnpm build:all. The 0.3.5 release preparation passed the regression suite, shared/extension TypeScript checks and public Chromium/Firefox builds. See the committed tests for executable cases. CI repeats these checks; local results do not imply CI has already run successfully.

The preceding 0.3.4 candidate was observed in an installed Chromium extension during a ranked draft: ten player profiles stayed visible, new picks synchronized, and a pick moved to the vetoed list correctly. That observation exposed the refresh-label and map-order issues addressed here.

Fixtures and mocked network/browser dependencies are used for automated tests. Repeated presence messages simulate the disappearance scenario; this is not a real 30-minute soak test. The current package has not completed an installed Firefox live-draft test. Firefox is built for temporary installation and retains its store data-declaration warning.

For normal-play reports, record the browser/version, extension version, whether the issue occurred in a starting room or draft, expected and actual behavior, and diagnostics copied promptly afterward. Review diagnostics before sharing. No special arranged beta lobby is required.
