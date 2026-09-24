# UmaLytics 0.4.0 Open Beta

## New features

- **Match History:** enter a completed match code or URL and browse its Lobby, Draft and Umas scenes. Review the saved maps, picks, bans, vetoes and tiebreaker, or open player details.
- **Player Lookup:** find a single player by name, Discord ID or profile URL and view their available ranked stats in UmaLytics.

## Interface improvements

- Dedicated Live / History / Profiles navigation with stable header sizing and button positions.
- The same Season / All-time control in every mode, with independent selections.
- Matching picked-Uma portraits and button styling in Live and History.
- Fixed History Lobby navigation from player details and preserved internal Uma-catalog scrolling.

## Performance and privacy

- Lookups share the existing paced request queue and profile cache; replaced requests are cancelled and available stats survive partial failures.
- Historical matches remain separate from the live lobby. Player statistics are current, not snapshots from the match date.
- Community builds continue to respect private detailed statistics. No hidden-profile reconstruction is included.

## Update

Download and extract the ZIP for your browser. Disable the old extension, load the new build, reopen UmaLytics and refresh every open drafter tab. Confirm **v0.4.0** in the header.

Chromium ZIP supports Chrome, Edge, Brave and Opera GX. Firefox/LibreWolf uses an unsigned temporary add-on and must be loaded again after a browser restart.

Automated regression, type and build checks passed before release. Live-session testing of the final installed packages, especially Firefox, remains limited. This is an Open Beta release.
