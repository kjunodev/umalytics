# UmaLytics

UmaLytics is a browser extension built with **TypeScript, React, and WXT** that helps competitive [Uma Drafter](https://drafter.uma.guide) players scout opponents and analyze live drafts. It opens a separate scouting window so players can review lobby participants and available player statistics while keeping the draft visible.

**Current release:** 0.3.0 Open Beta · **Browsers:** Chromium and Firefox

[Download the open beta](https://github.com/kjunodev/umalytics/releases/tag/v0.3.0-open-beta.1) · [Installation guide](INSTALL.md) · [Development guide](DEVELOPMENT.md)

## Features

The `0.3` iteration focuses on reliability and tester visibility:

- DOM-first custom lobby and live draft detection
- Manual lobby lock that freezes players while draft data keeps updating
- Small in-app version/build label
- One-click diagnostics copy for bug reports
- Clear handling for unknown and disqualified match-history rows
- Public-safe package output for Chromium and Firefox

## Privacy

This public release respects Uma Drafter private profile settings. If ranked Uma stats are private or unavailable, UmaLytics shows that private/unavailable state instead of deriving hidden stat summaries.

## Install

See [INSTALL.md](INSTALL.md) for browser install and update steps. Firefox currently uses a temporary add-on installation.

## How it works

The extension runs in the browser. This repository does not currently include a backend service or database.

| Component | Responsibility |
| --- | --- |
| Content script | Observes Uma Drafter's DOM, extracts lobby and draft information, and sends extension messages. |
| Page hook | Reads available synchronized state through page-level hooks and passes it to the content script. |
| Background script | Opens the scouting window, coordinates roster updates and profile requests, and writes extension storage. |
| React scouting window | Displays scouting and draft information and responds to storage updates. |
| Shared TypeScript package | Defines player, roster, match, and draft types used across the extension. |

### Engineering decisions

- **Multiple detection paths:** DOM observation and synchronized state support updates as the page changes. Retry and reconnect handling help recover when data is not immediately available.
- **Explicit asynchronous states:** Profile loading includes caching, request timeouts, and visible private/error states so users can distinguish missing data from an in-progress request.
- **Shared contracts:** TypeScript types and extension message validation connect the content script, background script, and UI.
- **Privacy-aware public builds:** The checked-in WXT configuration disables private-profile data derivation.

## Develop locally

The workspace pins **pnpm 9.15.4**. See [Development](DEVELOPMENT.md) for prerequisites, browser loading, troubleshooting, and the desktop/laptop workflow.

```sh
git clone https://github.com/skimuic/UmaLytics.git
cd UmaLytics
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

## Repository layout

```text
apps/extension/
  entrypoints/       Content/background scripts, page hook, and React scout UI
  utils/             Extraction, API requests, messaging, and storage
  public/            Extension icons
  wxt.config.ts      Browser manifest and build configuration
packages/shared/     Shared TypeScript models
downloads/           Packaged public beta builds
```

## Project and community

- [Professional repository](https://github.com/skimuic/UmaLytics): project source and engineering presentation.
- [Community repository](https://github.com/kjunodev/umalytics): public releases and community distribution.

For a bug report, include the extension version, browser, steps to reproduce, and relevant diagnostics.

## Current limitations

UmaLytics is an open beta. Changes to Uma Drafter's DOM or synchronized data can affect detection. Profile information depends on upstream availability and privacy settings.
