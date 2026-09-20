# UmaLytics 0.4.1

## Fixes

- Corrected misleading “No recent match history found” messages in player Details. Loading, unavailable, private, and successfully empty history now have distinct states.
- Improved Season / All-time switching and refresh handling so previously loaded scoped details are not discarded by another scope or an unfinished request.
- Prevented stale history from surviving a confirmed privacy denial or being reused for a different player or season.

Community privacy protections are unchanged. This public build does not retrieve match history or reconstruct private player statistics; unavailable history remains unavailable.

## Update

Download and extract the browser ZIP. Disable the previous extension, load the new build, reopen UmaLytics, and refresh your drafter tabs. Confirm **v0.4.1** in the header.

The Chromium ZIP supports Chrome, Edge, Brave, and Opera GX. Firefox / LibreWolf uses an unsigned temporary add-on, which must be loaded again after a browser restart. SHA256SUMS.txt contains optional download integrity checksums.

This remains a manually installed community build. Automated fixtures cover the history data path, cache merges, scope switching, privacy boundaries, and Details rendering; they do not replace live installed-browser testing.
