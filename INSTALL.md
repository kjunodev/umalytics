# Install UmaLytics

**Current public build: 0.3.0 Open Beta.** This is a testing release; installation and updates are manual.

## Download

- [Chromium ZIP — Chrome, Edge, Brave, Opera GX](https://github.com/kjunodev/umalytics/releases/download/v0.3.0-open-beta.1/umalytics-chromium-0.3.0-open-beta.1.zip)
- [Firefox ZIP — Firefox and compatible LibreWolf versions](https://github.com/kjunodev/umalytics/releases/download/v0.3.0-open-beta.1/umalytics-firefox-0.3.0-open-beta.1.zip)
- [Release notes and all versions](https://github.com/kjunodev/umalytics/releases)

Download the browser ZIP under **Assets**, not GitHub's automatically generated source-code archive. Extract it to a permanent folder you will keep, such as `UmaLytics/chromium` or `UmaLytics/firefox`.

The browser ZIP contains `manifest.json` at its root. Extraction tools may create a folder named after the ZIP; select the folder containing `manifest.json`, whatever its name. A `chrome-mv3` or `firefox-mv3` wrapper folder is not included in these downloads.

## Chrome / Edge / Brave / Opera GX

1. Extract the Chromium ZIP.
2. Open `chrome://extensions`, `edge://extensions`, `brave://extensions`, or `opera://extensions` for your browser.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Open or refresh [Uma Drafter](https://drafter.uma.guide).
6. Click the UmaLytics extension icon to open the scouting window. Use the browser's extensions menu if the icon is not pinned.

Keep the extracted folder in place while the extension is installed.

## Firefox / LibreWolf

**Temporary installation ends when the browser restarts.** Repeat these steps after a restart. This ZIP is a testing package, not a signed permanent add-on.

1. Extract the Firefox ZIP.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on**.
4. Select `manifest.json` from the extracted folder.
5. Open or refresh [Uma Drafter](https://drafter.uma.guide).
6. Click the UmaLytics extension icon to open the scouting window.

See [Mozilla's temporary-installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/) for details.

## Update an existing installation

1. Download the new browser ZIP and extract it to a separate folder first.
2. Confirm that the new folder contains `manifest.json`.
3. Replace the old extension files **at the same folder path you originally loaded** with the new contents. Keep the previous ZIP as a backup until the update is verified.
4. Click **Reload** on the extension's browser management page. In Firefox, load it again if the temporary installation has ended.
5. Refresh open Uma Drafter tabs and reopen the scouting window.
6. Confirm the new version in the in-app header.

If you move the extension to a different folder, load it from that new location explicitly; Reload still uses the previous location. Avoid leaving two copies enabled. Removing an extension may reset its local settings.

## Troubleshooting and feedback

- **Manifest not found:** select the folder directly containing `manifest.json`, not its parent or the ZIP itself in Chromium.
- **No lobby detected:** refresh Uma Drafter, reopen the scout window, and verify that the extension is enabled.
- **Private or unavailable statistics:** these states are expected when upstream data is private or unavailable.
- **Firefox extension missing after restart:** repeat the temporary-installation steps above.
- **Still stuck:** [report a bug](https://github.com/kjunodev/umalytics/issues/new?template=bug_report.md) with your browser, extension version, reproduction steps, and copied diagnostics. Review diagnostics for lobby information before posting.

## Build from source

The workspace uses pnpm 9.15.4. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

Chromium build output: `apps/extension/.output/chrome-mv3/`.

```sh
pnpm --filter @umalytics/extension exec wxt build -b firefox
```

Firefox build output: `apps/extension/.output/firefox-mv3/`. These generated build-folder names differ from the flat layout inside the downloadable ZIPs. In PowerShell, use `pnpm.cmd` if script execution blocks `pnpm`.
