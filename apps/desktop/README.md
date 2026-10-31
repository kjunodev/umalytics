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
are ready. An unexpected disconnect clears active room state; the desktop
retains the last roster, profiles and draft for a dimmed reconnect view.

Only v1 text envelopes are forwarded. Frames and assembled messages have a
2 MiB limit enforced by tokio-tungstenite. Size and protocol errors close the
connection; the next client can reconnect. Bad JSON, unsupported envelopes and
binary data messages increment a counts-only diagnostic. Ping/pong control
frames do not increment rejections. Bad JSON does not close
the connection. A port conflict appears in the UI.

The icon rail groups Lobby and Draft, Stamina, then Players, History and Umas,
with Settings at the bottom. Lobby cards and the live Draft layout are desktop
components; player drawers and data pages reuse the shared views.
Below 600 CSS pixels by default the shell shows compact Lobby/Draft; Compact and
Expand resize the native window and restore its previous logical size. Pin on
top, display mode, compact threshold, and the last page are saved locally in `shell.json`.
Settings exposes feed counters and draft state during Vite development only.
The scope selector drives the shared views through desktop UiServices.
Explorer, title and history requests call the existing core functions through
CorePlatform and the Rust HTTP plugin. Request IDs own abort controllers so
cancelling a drawer request aborts its underlying fetch. Recent player chips
use the extension's `playersRecentViewed` key and shape in the Tauri store.
Request pacing, cancellation and 429
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

The script starts and stops its own Vite server. It captures full Lobby,
drawer, mid-draft, Players leaderboard and directory results, History, Umas
and Stamina at 1280×800 and 1000×700, compact Lobby/drawer/Draft at 440×860,
the 5/4/3/2-column Lobby layouts, all live feed states and the three Draft phases.
Pick order is shown only when the received snapshot includes complete explicit
Uma pick history; per-team slot numbers never establish global order.
Screenshots go to `.shots/` (or `DESKTOP_SHOTS_DIR`). It rejects horizontal
overflow, unexpected column counts, clipped text (including every
select option), unexpected external requests, and page errors, and
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

Arena tokens and font faces live in `src/tokens.css`; desktop styles live in
`src/arena.css`. Saira Condensed, Barlow and Geist Mono are bundled under
`src/fonts/`, each with its OFL licence. Fonts load locally under `font-src 'self'`.
The port-conflict screen copies only listener status and accepted/rejected counts.

## Stamina check

The Stamina screen offers all 104 Global drafter-pool maps, including Morioka
2000 m. Each map uses an instance on its exact engine course. The best available
grade is selected, preferring G1; the instance, time and month are shown in run
details. Ground, weather and season are selectable independently.

Average lobby is the default: your runner plus eight skill-free opponents at
1600/1200/1200/600/1200, A aptitudes and Great mood (2 Front, 3 Pace, 2 Late,
1 End). Pacemaker is selectable as a real two-runner field, with a Front Runner
at 1605/1200/1194/664/1200. Position and order skill conditions see the actual
field size. Opponent builds stay fixed throughout the stamina search.
Mirror uses eight opponents with the submitted runner's five raw stats,
A aptitudes, Great mood, no skills and the same 2/3/2/1 strategy distribution.
Their stamina stays fixed at the submitted value throughout the search.

The toolbar opens race/condition pickers and advanced options. Build opens a
side panel over the results; Escape closes the active picker or panel. The
last race, conditions, build, skills and analysis options are saved in the
Tauri store (`stamina.json`, `last-inputs-v1`) and validated on restore.

Optional local GameTora metadata is read at startup from
`UMALYTICS_GAMEDATA_DIR`, defaulting in development to
`%USERPROFILE%\Documents\Coding Projects\UmaLytics-GameData\gametora`.
This folder supplies `skills.json` and `icons/<iconid>.webp` (or `.png`).
Engine IDs remain authoritative; inherited skills join through `gene_version`.
Global filtering uses the parent's `loc.en`; Show all regions includes the
remaining engine skills. Search supports fuzzy name matching and remembers
recent selections. Only unique skills expose a level control.
Without readable local metadata, the engine catalog remains available with
engine names, no icons, and one quiet notice in the skill section. No game
data or artwork is copied into the repository or frontend build.
Tauri's asset scope starts empty and allows only individually resolved icon
files; canonical paths outside the configured icons folder are rejected.

Analysis defaults are Assume skills activate On, Rushed On, Spot Struggle Off,
Dueling Off, and Lane movement On. The skill assumption uses the engine's
AlwaysPass option for both skill Wit lotteries. It keeps their RNG draws;
timing, position and other skill conditions still apply. Switching it Off uses
normal skill lotteries and plain unconditional rates. Every simulated seed
counts in either mode. The other toggles gate admission to their mechanics;
lane movement Off retains overlap separation.

Survival requires positive HP throughout every tick, including the goal-crossing
tick, and no sticky HP-out flag. Full spurt uses the retained engine plan
TRUE_EXCEED_NEED_MAX_HP when your runner finishes. At-entry spurt is the first
late-race plan, before later heal recalculations.
The headline uses the joint 90% threshold: count races where both full spurt
and survival succeed, using the same cached race outcomes. This is distinct
from requiring two marginal 90% rates. The two marginal thresholds, each
heal's nominal contribution, and all three curves remain available. The
per-stamina table starts collapsed. Pass/short uses the simulated joint rate
and the conservative raw threshold; heal equivalents alone do not decide it.

The displayed curve spans 600–1400 in steps of 50, initially using 32 seeds.
The conservative 90% thresholds are refined to 10 stamina over 10–2000, requiring
higher sampled values to pass too. Current stamina and threshold points use the
full bank: 256 seeds without heals, 512 with heals, or an explicit 1–1000.
These are finite-sample estimates. Effective stamina adds positive heal
equivalents; needed effective stamina evaluates them at each true threshold.
Timing, overflow and unmet conditions can reduce a heal's value.

IPC uses snake_case fields. Single-race stamina_check accepts {request_id?,
build, race, field?, seeds?, assume_skills_activate?, rushed?, spot_struggle?,
dueling?, lane_movement?}. The build contains running_style, raw stats
{speed, stamina, pow, guts, wiz}, motivation, aptitude arrays distance[4],
style[4], ground[2], and skills[{id, level}]. A race is {map_id,
ground_condition, weather, season}. Stats allow 1–2000, aptitude grades 1–8,
skill levels 1–6, and at most 100 distinct skills.

stamina_check_races replaces race with races (1–7) and shares the same build,
field and analysis options. It validates every input before starting, emits
stamina-race-result events, and returns results in input order. Both commands
emit stamina-progress and support cancel_stamina_check. Results retain the
submitted input snapshot. Workers check cancellation before each race and
every 32 ticks; at most eight workers simulate concurrently.
Progress reports Mapping the curve, Refining thresholds, and Done. Only the
fixed coarse mapping stage reports partial work. Adaptive refinement marks a
stage rather than dividing by an expanding race total; the bar never retreats.

The engine dependency is pinned to the fork commit in Cargo.toml/Cargo.lock.
GameData loads lazily from uma_race_sim::data::DATA_DIR in that Cargo checkout.
This development integration requires the checkout to remain available; it is
not a portable installer. Do not copy game data into this repository. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Native tests cover all pool courses, option/default propagation, skill
conditions, HP/spurt metrics, deterministic sampling, cancellation and the
multi-race API. The local two-bank acceptance benchmark uses a release build:

```powershell
cargo test --release --manifest-path apps/desktop/src-tauri/Cargo.toml --locked benchmark_seed_banks -- --ignored --nocapture
```

The opt-in `measure_field_strength` native test compares the seven round-1
fixtures against Average, Mirror and Weak (1200/900/900/500/900) fields with
the default 256/512 seed banks and emits raw/effective thresholds. Weak is a
measurement fixture, not a toolbar choice. Average remains the default.
