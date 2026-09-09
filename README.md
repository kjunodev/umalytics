# UmaLytics

UmaLytics is a browser extension for [Uma Drafter](https://drafter.uma.guide) that opens a separate scouting window during lobbies and live drafts. Review the players in your lobby and their available statistics without leaving the draft.

**0.3.0 Open Beta — manual installation and updates.**

| Browser | Download |
| --- | --- |
| Chrome, Edge, Brave, Opera GX | [Download Chromium ZIP](https://github.com/kjunodev/umalytics/releases/download/v0.3.0-open-beta.1/umalytics-chromium-0.3.0-open-beta.1.zip) |
| Firefox / LibreWolf | [Download Firefox ZIP](https://github.com/kjunodev/umalytics/releases/download/v0.3.0-open-beta.1/umalytics-firefox-0.3.0-open-beta.1.zip) — temporary installation; reload after browser restart |

[Install or update](INSTALL.md) · [Release notes](https://github.com/kjunodev/umalytics/releases) · [Report a bug](https://github.com/kjunodev/umalytics/issues/new?template=bug_report.md)

## Features

- DOM-first custom lobby detection and live draft updates.
- A separate scouting window with player statistics and visible loading, private, and timeout states.
- Manual lobby lock: keep the roster fixed while draft data continues updating.
- Version/build information and one-click diagnostics for feedback.
- Explicit handling of unknown and disqualified match-history rows.

## Start scouting

1. Download the ZIP for your browser and follow [the installation guide](INSTALL.md).
2. Open Uma Drafter and enter a lobby or draft.
3. Click the UmaLytics extension icon to open the scouting window.
4. Use lobby lock when you want to keep the current roster fixed.

## Privacy and limitations

The public build respects Uma Drafter's private profile settings. Private or unavailable ranked statistics are shown as such rather than reconstructed into hidden summaries. Profile lookups contact Uma Drafter's services using player identifiers; cached scouting state is stored locally by the extension.

This is an open beta. Upstream page/API changes can affect detection and profile loading. Firefox currently uses temporary installation rather than a signed permanent add-on.

## Feedback

[Open a bug report](https://github.com/kjunodev/umalytics/issues/new?template=bug_report.md) with your browser, UmaLytics version, steps to reproduce, expected behavior, and actual behavior. Copy in-app diagnostics if relevant; review them before posting because they can include lobby information. Screenshots are helpful when they show the problem without exposing information you want to keep private.

## Community

TERUMI APPROVED.

This repository hosts the community downloads and feedback. The project is built with TypeScript, React, and WXT; `apps/extension` contains the extension and `packages/shared` contains shared types. There is no backend or database package in this repository.

## Release policy

Open beta versions are testing releases and should be marked as **pre-releases** on GitHub. Use the explicit versioned download links above or the releases page; a stable `releases/latest` link may not select a beta. Updates are manual, and past download assets retain their original contents.
