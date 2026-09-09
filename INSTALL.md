# Install UmaLytics

Use the public package for normal release/testing.

## Package Names

- Chromium: `downloads/umalytics-chromium-0.3.0-open-beta.1.zip`
- Firefox: `downloads/umalytics-firefox-0.3.0-open-beta.1.zip`

The in-app header shows the installed version.

## Chrome / Edge / Brave / Opera GX

1. Unzip the Chromium package.
2. Open your browser extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Opera GX: `opera://extensions`
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select the unzipped `chrome-mv3` folder.
6. Open or refresh `https://drafter.uma.guide`.
7. Click the UmaLytics extension icon to open the scout window.

## Firefox / LibreWolf

1. Unzip the Firefox package.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on`.
4. Select `manifest.json` inside the unzipped `firefox-mv3` folder.
5. Open or refresh `https://drafter.uma.guide`.
6. Click the UmaLytics extension icon to open the scout window.

## Updating

1. Remove or replace the old unzipped UmaLytics folder.
2. Reload the extension from your browser extensions page.
3. Refresh any open Uma Drafter tabs.
4. Reopen the scout window from the UmaLytics extension icon.

For local unpacked development, rebuild first, then click `Reload` on the unpacked extension.

Public local build:

```powershell
pnpm.cmd --filter @umalytics/extension build
```
