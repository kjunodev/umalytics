# UmaLytics

UmaLytics is a TERUMI APPROVED browser extension for Uma Drafter that opens a separate scouting window while you are in a lobby or draft.

It is built to help players quickly understand who is in the lobby and what each player is known for before and during draft.

## Open Beta

Current release: **UmaLytics 0.2.0 Open Beta**

Download the ZIP for your browser family from the [downloads](downloads) folder:

| Browser | Package |
| --- | --- |
| Chrome, Edge, Brave, Opera GX | `umalytics-chromium-0.2.0-open-beta.1.zip` |
| Firefox, LibreWolf | `umalytics-firefox-0.2.0-open-beta.1.zip` |

## Features

- Independent UmaLytics scout window opened from the browser extension icon.
- Lobby scouting for both Uma Drafter teams.
- Stable player cards for ratings, W-L, win rate, PPG, MVP count, and most played Umas.
- Current season and all-time stat scope toggle.
- Player badges for rank, scoring, consistency, sample size, and other scouting signals.
- Party indicators through card highlights.
- Captain crown indicator.
- Live draft view for maps, picked Umas, banned Umas, and vetoed Umas.
- Picked Uma history checks by team.
- Uma Planner for pre-draft scouting.
- Uma catalog search and sorting by total hits, release order, or alphabetical.
- Draft plan tray for pinned Umas.
- Local profile caching to reduce repeated data requests.

## Source

This repository includes the source code used to build the beta packages:

- `apps/extension`: WXT + React + TypeScript browser extension
- `packages/shared`: shared TypeScript types

Backend and database packages are not part of this release.

## Development

```powershell
pnpm install
pnpm --filter @umalytics/extension build
```

Browser-specific builds:

```powershell
pnpm --filter @umalytics/extension exec wxt build --browser chrome
pnpm --filter @umalytics/extension exec wxt build --browser firefox
```

## Install

See [INSTALL.md](INSTALL.md) for browser install steps.

## Important Notes

UmaLytics is distributed as an unpacked beta extension. You may need to reload or reinstall it manually when updating.

Firefox-family temporary add-ons may be removed after restarting the browser. This is a browser limitation for unsigned temporary extensions.

UmaLytics is an independent scouting companion for Uma Drafter. It does not modify drafts, submit picks, or change data on Uma Drafter.

## Credits

- UmaLytics by **k.juno**
- Uma Drafter by **Terumi**
