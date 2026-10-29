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
binary data messages increment a counts-only diagnostic. Ping/pong control
frames do not increment rejections. Bad JSON does not close
the connection. A port conflict appears in the UI.

The sidebar opens the live Lobby, an interim Draft view, Stamina, and upcoming
tools. Below 760 CSS pixels the shell shows compact Lobby/Draft; Compact and
Expand resize the native window and restore its previous logical size. Pin on
top, display mode, and the last page are saved locally in `shell.json`.
Settings exposes feed counters and draft state during Vite development only.
The scope selector loads existing core profile
functions through the Rust HTTP plugin. Request pacing, cancellation and 429
cooldowns remain in core. HTTP access is limited to the drafter API, redirects
are disabled, and requests identify `UmaLytics-Desktop/<version>`. Persistent
profile storage uses the store plugin; session caches remain in memory.
History never supplies statistics or badges.

Frontend screenshots and interaction checks run locally with mocked Tauri IPC:

```powershell
pnpm --version # must be 9.15.4, with the PATH above
pnpm --filter @umalytics/desktop exec playwright install chromium
pnpm --filter @umalytics/desktop shots
```

The script starts and stops its own Vite server. It captures full Lobby and
Stamina at 1280×800 and 1000×700, compact Lobby/Draft at 440×860, and an empty
Lobby. Screenshots go to `.shots/` (or `DESKTOP_SHOTS_DIR`). It rejects horizontal
overflow, clipped text, unexpected external requests, and page errors, and
checks scope changes, persistence, skill editing, stale results and cancellation.
All replay accounts and simulation results in this harness are synthetic.
Window resizing and pin checks use mocked IPC; verify actual OS behavior in
`tauri dev` before release. These checks are not part of CI.

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --locked -- -D warnings
```

`pnpm build:all` builds only the two extension targets.
`pnpm build:desktop` builds the desktop frontend, independently versioned at 0.1.0.
Native builds use the Tauri CLI. Packaging, signing and auto-update are disabled.

## Stamina check

Open the **Stamina** view next to Debug feed. Select a Champions Meeting
preset or course, conditions, strategy, raw stats, mood, aptitudes and
optional skills in processing order. Presets from the engine's `names.json`
appear first and fill course, ground condition, weather and season. Skill
names and courses come from the pinned engine's current data, not a separate
maintained list. Courses with no matching G1 instance are shown disabled.

The simulation is an **assumption about a neutral field**, not a prediction
of a particular lobby: the measured runner is in gate 1, with eight copies
of its original build in gates 2–9. The opponents keep the input stamina
throughout the sweep. This gives the engine a field for pace and position
keep while avoiding assumptions about opponents' builds. All nine runners
have the selected mood, strategy and aptitudes. Skills apply to your uma
only; the field has none. This prevents copied HP-draining skills from
turning the neutral field into eight attackers.

The sweep includes the exact input stamina and values downward/upward in
steps of 50, plus clamped endpoints 300 and 2000. It covers the full range
so the smallest passing tested value can be reported even when race outcomes
are not monotonic. Each point runs the same deterministic seeds (default
200, allowed 1–1000). “95% threshold” means the smallest **tested** stamina
with at least 95% no HP-out; it is a finite-sample estimate, not an exact
minimum or a statistical confidence guarantee. “Not reached” means no tested
value passed. Stats are raw, before the engine's motivation and >1200
adjustments (the portion above 1200 is halved). Stamina must be 300–2000;
other stats 1–2000; aptitude grades 1 (G)–8 (S); skill levels 1–6, at most
100 distinct known skill IDs.

Every race uses Champions rules (`race_type = 5`) and daytime (`time = 2`).
The race identity is the first matching G1 Champions Meeting entry in
`names.json`; otherwise it is the lowest valid G1 instance on that exact
course. This preserves grade/race-specific skill conditions without borrowing
an unrelated course. The chosen instance is shown in the form and returned
with the result.

HP is inspected every engine tick (0.0666 simulated seconds), including the
goal-crossing tick. The engine's sticky `is_hp_empty_on_race` flag catches
HP-outs followed by healing. Average minimum HP is the mean of the measured
runner's tick minima through its finish. Success means its HP never emptied
under this convention; it does not mean winning or maintaining a full-speed
last spurt. Simulation stops once gate 1 finishes, so post-goal consumption
does not affect the result.

IPC commands (snake_case input/result fields):

- `engine_catalog() -> Result<Catalog, String>`: courses `{id, track_name,
  distance, surface, direction, race_instance_id}`, CM presets, and skills
  `{id, name}`. Surface is 1 turf/2 dirt; direction is 1 right/2 left/
  3 straight-right/4 straight-left.
- `stamina_check(input) -> Result<CheckResult, String>`: input `{request_id?,
  course_set_id, ground_condition, weather, season, running_style, stats:
  {speed, stamina, pow, guts, wiz}, motivation, distance: [4 grades], style:
  [4 grades], ground: [2 grades], skills?: [{id, level}], seeds?}`. Strategy
  is 1 front runner/2 pace chaser/3 late surger/4 end closer; mood is 1–5.
  Ground/weather/season use the engine's 1-based values shown in the UI.
  Returns `{input, request_id, curve: [{stamina, no_hp_out_percent, avg_min_hp}],
  current, threshold, seeds, races, elapsed_ms, ms_per_race, race_instance_id}`;
  threshold is null when not reached. `input` is the full input snapshot for
  the run. Results retain its build and course labels after form edits, with
  a notice to run again when inputs change.
- `cancel_stamina_check() -> Result<(), String>` cancels the active request.

Work runs off the UI thread, with races spread across available CPU cores.
A new request cancels the previous one. Workers check cancellation before
each race and every 32 ticks within a race. `stamina-progress` events carry
`{request_id, completed, total}`; the frontend filters stale request IDs and
out-of-order counts. Errors, including upstream data/simulation failures,
are returned as messages. Timing is total wall time (including setup) divided
by race count across cores, not serial CPU time per race.

`GameData::load(engine_data_dir(), DataEra::current())` is lazy and cached
once per process. `engine_data_dir()` currently returns
`Path::new(uma_race_sim::data::DATA_DIR)`, the dependency checkout's data
directory. Missing data returns an error. The single boundary can be replaced
by a future packaging provider; this development integration requires the
Cargo checkout to remain available and does not make a portable installer.
Do not copy the engine's game data into this repository. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the engine MIT license
and the separate Cygames data ownership notice.

Native tests cover input validation, deterministic fixed-seed curves,
neutral opponents, cancellation/replacement and ping/pong behavior. The
ignored local benchmark runs 200 seeds across the full sweep:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked benchmark_200_seed_sweep -- --ignored --nocapture
```

This runs companion tests only; it does not run or patch upstream tests
(the upstream `data::tests::load_and_overlay` skill count is stale).
