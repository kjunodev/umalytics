# Layout preview harness

A dev-only harness that renders every scene and card state from static
fixtures (`fixtures.ts`), so layout and sizing work can be checked visually
without a live Uma Drafter lobby. It is never bundled into the extension —
`pnpm build`/`pnpm build:all` only compile `entrypoints/`, and this lives
under `dev/`, entirely outside that tree. `apps/extension/package.json`'s
`preview`/`preview:shots` scripts are the only things that reference it.

## Running it

```bash
pnpm --filter @umalytics/extension preview
```

Opens a standalone Vite dev server (default `http://localhost:4174`,
separate from `wxt dev`) with a scene switcher using the app's real header
(Live/History/Players, Lobby/Draft/Umas). Click around like the real
extension; the Draft scene gets an extra "Mid-draft / Complete" toggle
(top-right, only in this harness) since `DraftScene` normally renders one
live snapshot.

Deep link to a specific state with query params (used by `preview:shots`):

- `?mode=live|history|profiles`
- `&scene=lobby|draft|umas`
- `&draft=mid|complete`
- `&player=<discordId>:<userId>` — opens the drawer for that player
- `&uiSize=small|default|large` — overrides the preview's saved UI size

## Screenshots

```bash
pnpm --filter @umalytics/extension preview:shots
```

Starts the harness headlessly (Playwright + the same Vite config) and saves
one PNG per scene, viewport, and UI size into `.shots/` (git-ignored):
lobby, drawer, draft (mid and complete), Umas, Players (leaderboard), and
History (lobby and draft), each at 1024x768, 1100x900, 1265x1100,
1280x720, 1366x768, 1625x1360, 1920x1080, and 2560x1300, in Small,
Default, and Large. The 192 cases also run `geometry.mjs`, checking component
containment, sibling overlap, text overflow, and horizontal page overflow.
Failures make the command exit unsuccessfully; per-case results and element
counts are saved in `.shots/geometry.json`. Intentional overlays (tooltips,
card hit targets, and the drawer backdrop) are excluded from sibling checks.
The harness uses installed Chrome by default (`PREVIEW_BROWSER` can select
another Playwright Chromium channel). Portrait and team fixtures are local;
external image requests are disabled during automated captures.

## How it avoids the real extension runtime

Real scenes call into `wxt/browser` (`browser.runtime.sendMessage`,
`browser.storage.local`, `browser.runtime.connect` for the explorer port).
None of that exists outside an actual extension, so `vite.config.ts` aliases
`wxt/browser` to `mocks/browser.ts`, which answers every call from
`fixtures.ts` instead. Everything else — every `ui/` component, all CSS,
the UI-size initialization — is the real, unmodified source.

The harness uses the same display rules as the extension. Match history is
shown in details but never used to calculate ranked statistics.

## Fixtures

`fixtures.ts` has a 2x5 roster covering the required card states (loaded,
loading, restricted stats, error, and a player with fewer than 3 Umas),
a mid-draft and a complete-with-tiebreaker-and-vetoes `DraftSnapshot`, a
season leaderboard, and canned match-history pages. `discordId(index)`
generates realistic-looking numeric IDs — `getLookupDiscordId` only treats a
16-20 digit numeric string as a real player, so anything else (e.g.
`"discord-0"`) silently falls into the "no lookup available" fallback UI
instead of showing real card content.
