# Install or update UmaLytics 0.3.9

Download the public Chromium or Firefox package linked from the README. Extract it into a permanent folder; manifest.json is at the root of the extracted package.

## Chrome, Edge, Brave and Opera GX

1. Open your browser's extensions page and enable Developer mode.
2. Select Load unpacked and choose the extracted folder containing manifest.json.
3. Refresh the Uma Drafter tab and click the UmaLytics icon to open the scout.

## Firefox and LibreWolf

1. Open about:debugging and choose This Firefox.
2. Select Load Temporary Add-on and choose the extracted manifest.json.
3. Refresh the Uma Drafter tab and click the extension icon.

This unsigned package is temporary and must be loaded again after Firefox restarts. Permanent installation and automatic updates are not provided by these ZIPs.

## Updating and rollback

Extract each version into its own folder. Disable the previous copy before loading the new copy so two extensions do not make duplicate requests. Keep the previous folder if you want to roll back. If you replace files in the existing extension folder instead, reload that extension explicitly.

**Refresh every open drafter tab once after an upgrade, then reopen the scout.** The page hook must attach to newly created connections. Confirm v0.3.9 in the header.

Updates and rollback are manual. To roll back, disable the new copy and reload the previous folder, then refresh the drafter tab. Different unpacked extension installations can have separate caches and preferences.

## Troubleshooting

- Wrong lobby: unlock Lobby Lock, select the intended drafter tab, then reopen the scout if needed.
- Private stats: this is expected when the player has hidden their ranked details.
- API paused: allow automatic recovery; repeated manual refreshes do not bypass rate limits.
- Missing player identity: a room must expose a verified identifier before detailed scouting is possible.
- Other problems: Copy diagnostics soon afterward and include the version/browser in a bug report.

The Latest stats check label describes the newest available check for the selected scope. It does not mean every profile was checked simultaneously. The Refresh countdown follows manual refreshes, not draft activity.
