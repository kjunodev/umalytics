# Desktop companion

From the workspace root, using Node 24, pnpm 9.15.4, Rust stable MSVC and
VS 2022 C++ Build Tools in PowerShell:

```powershell
$env:PATH = "C:\Program Files\nodejs;C:\Users\junoo\.cargo\bin;" + $env:PATH
pnpm --version # must be 9.15.4
pnpm install --frozen-lockfile
pnpm --filter @umalytics/desktop tauri dev
```

In a second PowerShell terminal with the same PATH and pnpm version:

```powershell
pnpm --filter @umalytics/desktop replay
# Optional: an absolute path to a compatible timeline fixture
pnpm --filter @umalytics/desktop replay C:\path\to\casual-room-replay.json
```

The replay pauses five seconds at the final six-player roster, then sends
`left` and disconnects. It accepts room-event timelines; `completed-match.json`
is a history report and is deliberately rejected. Synthetic fixture accounts
are not expected to have real API statistics.

The app listens on `127.0.0.1:38917`. The production Origin must be exactly
`https://drafter.uma.guide`. The replay Origin,
`http://umalytics-replay.localhost`, is accepted only in debug builds;
release builds reject it, with no environment override. Each successful new
handshake replaces the active producer, closing it and clearing its room
before serving the new client. Failed handshakes leave the active client intact.
The listener starts after frontend event subscriptions
are ready. An unexpected disconnect clears room state and cancels profile work.

Only v1 text envelopes are forwarded. Frames and assembled messages have a
2 MiB limit enforced by tokio-tungstenite. Size and protocol errors close the
connection; the next client can reconnect. Bad JSON, unsupported envelopes and
non-text messages increment a counts-only diagnostic. Bad JSON does not close
the connection. A port conflict appears in the UI.

The debug UI shows status/counters, room, draft phase, each team's roster and
Uma/map pick and ban counts. The scope selector loads existing core profile
functions through the Rust HTTP plugin. Request pacing, cancellation and 429
cooldowns remain in core. HTTP access is limited to the drafter API, redirects
are disabled, and requests identify `UmaLytics-Desktop/<version>`. Persistent
profile storage uses the store plugin; session caches remain in memory.
History never supplies statistics or badges.

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --locked -- -D warnings
```

`pnpm build:all` builds only the two extension targets.
`pnpm build:desktop` builds the desktop frontend, independently versioned at 0.1.0.
Native builds use the Tauri CLI. Packaging, signing and auto-update are disabled.
