# UmaLytics

UmaLytics opens a separate scouting window beside [Uma Drafter](https://drafter.uma.guide). See the players in team slots, their available ranked statistics, and the confirmed live draft.

**0.3.9 Open Beta — manual installation and updates.**

| Browser | Download |
| --- | --- |
| Chrome, Edge, Brave, Opera GX | [Chromium ZIP](downloads/umalytics-chromium-0.3.9-open-beta.1.zip) |
| Firefox / LibreWolf | [Firefox ZIP](downloads/umalytics-firefox-0.3.9-open-beta.1.zip) — temporary installation |

[Install or update](INSTALL.md) · [Changes](CHANGELOG.md) · [Privacy](PRIVACY.md) · [Report a bug](https://github.com/kjunodev/umalytics/issues/new?template=bug_report.md)

## Start scouting

1. Extract the package and follow the installation guide.
2. Open or refresh Uma Drafter, then enter a room or spectate a draft.
3. Click the UmaLytics extension icon. Use Lobby for player cards, Draft for confirmed selections, and Umas for team experience.
4. Choose Season or All-time. Leave Lobby Lock unlocked to follow room changes; lock it only when you want to keep the displayed players fixed.

## What is included

- Starting-room trainer identification, with player identities kept independent of companion images and spectators excluded from the roster.
- Versioned room events and DOM fallback for lobby and draft detection.
- Cached player summaries, selected-scope loading, and explicit private/unavailable states.
- Paced API requests, request cancellation on room changes, and bounded automatic recovery after rate limits.
- Confirmed picks, bans, vetoes, map order and a tiebreaker view.
- Local diagnostics that you can copy when reporting a problem.

## Privacy

This source and its packages respect private ranked stats. They do not request match history or reconstruct hidden statistics. The community configuration cannot enable that behavior with a build flag. Public identity, rank or rating may still appear when separately exposed by the site; private detailed statistics remain unavailable.

The extension contacts Uma Drafter's services with player identifiers. Scouting state and a bounded diagnostic trace stay in local extension storage. There is no UmaLytics backend, analytics service or automatic diagnostic upload. See [PRIVACY.md](PRIVACY.md).

## Expectations

This is the public testing release. Cached data can appear quickly; uncached data depends on the upstream API. HTTP 429 pauses requests rather than bypassing the server's limits. Site changes can affect detection. A player whose room exposes no verified identity cannot be looked up reliably.

Chromium behavior has been observed during a live ranked draft on the preceding candidate. The 0.3.9 changes have automated regression coverage; see [TESTING.md](TESTING.md) for exact checks and limits. Firefox remains an unsigned temporary add-on, not a permanent store installation. Human team cards currently assume up to five slots per side; complete support for every custom mode is not claimed.

## Development and feedback

Built with TypeScript, React and WXT. [DEVELOPMENT.md](DEVELOPMENT.md) documents tests and reproducible public builds. [The portfolio repository](https://github.com/skimuic/UmaLytics) describes the engineering; this repository serves community downloads and feedback.

Bug reports should include the version, browser, expected/actual behavior and diagnostics copied soon after the problem. Review the report before posting: its status section can include player IDs, room codes and API error paths. Older download assets retain their original contents.
