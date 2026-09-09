# UmaLytics

UmaLytics is a TERUMI APPROVED browser extension for Uma Drafter that opens a separate scouting window while you are in a lobby or draft.

It is built to help players quickly understand who is in the lobby and what each player is known for before and during draft.

## Current Build

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

See `INSTALL.md` for browser install and update steps.

## Source

- `apps/extension`: WXT + React + TypeScript browser extension
- `packages/shared`: shared TypeScript types

Backend and database packages are intentionally not initialized yet.
