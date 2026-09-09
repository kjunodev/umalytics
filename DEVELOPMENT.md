# Developing UmaLytics

## Prerequisites

- Git.
- Node.js and npm. Use the same Node version on your desktop and laptop; this repository does not yet declare a supported Node version range.
- **pnpm 9.15.4**, as pinned in the root `package.json`.
- A Chromium browser or Firefox for manual extension checks.

Dependency installation, typechecking, and production builds for both browsers were verified on Windows with Node.js 24.19.0 and pnpm 9.15.4. This is a verified environment, not a declared minimum Node version. Live browser behavior still needs the manual checks below.

If pnpm is not already available, install the pinned version with npm:

```sh
npm install --global pnpm@9.15.4
node --version
pnpm --version
```

The final command should report `9.15.4`. No local database, backend service, API key, or `.env` file is required by the checked-in configuration. Live scouting uses Uma Drafter and its API.

## Set up a clean checkout

```sh
git clone https://github.com/skimuic/UmaLytics.git
cd UmaLytics
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

Run workspace commands from the repository root. Installation runs `wxt prepare` through the extension's `postinstall` script to generate WXT configuration and types.

Use pnpm for this workspace rather than mixing npm/yarn installs with `pnpm-lock.yaml`. A frozen-lockfile error means the manifests and lockfile need investigation; do not delete the lockfile just to bypass it.

## Development and browser builds

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start WXT development mode for Chromium. |
| `pnpm typecheck` | Run the workspace TypeScript checks. |
| `pnpm build` | Create a production Chromium extension. |
| `pnpm --filter @umalytics/extension exec wxt build -b firefox` | Create a production Firefox extension. |

Production output is generated under `apps/extension/.output/`:

- Chromium: `chrome-mv3/`
- Firefox: `firefox-mv3/`

Follow [INSTALL.md](INSTALL.md), using the generated folder instead of an extracted download. After rebuilding, reload the extension, refresh Uma Drafter, and reopen the scouting window.

Development mode may launch a separate browser profile. For a manual check in your usual browser, use a production build and load it unpacked.

The current Firefox build emits WXT warnings about a missing extension ID and `data_collection_permissions`. Build success does not establish Firefox installation or store-submission readiness; review the manifest requirements before distribution changes.

## Manual verification

Typechecking and building do not prove that live scouting works. Before a release:

1. Load the new build and confirm its version in the scouting window.
2. Open a Uma Drafter lobby and check the detected players.
3. Lock the lobby roster and confirm draft updates still appear during a draft.
4. Check the loading and unavailable/private states with applicable profiles.
5. Refresh the page or reopen the scout window and check reconnection.
6. Copy diagnostics and confirm they are useful for reproducing any failure.
7. Repeat applicable checks in Chromium and Firefox.

The repository currently has no automated test script. Record which browser checks you actually performed when describing a change.

## Desktop and laptop workflow

Keep a separate checkout and dependency installation on each machine. On WSL, keep the checkout in the Linux filesystem and install dependencies inside WSL; do not reuse Windows `node_modules`.

Before starting work:

```sh
git status --short
git branch --show-current
git remote -v
git fetch origin
```

Review any local changes before switching branches or pulling. On a clean checkout of the branch you intend to update:

```sh
git pull --ff-only
pnpm install --frozen-lockfile
```

If the pull reports divergent history, inspect it before deciding how to reconcile it. Commit and push finished work on a feature branch before moving to the other machine.

### Commit identity

Check the identity Git will use inside each checkout:

```sh
git config --get user.name
git config --get user.email
```

If necessary, set repository-local values using your chosen name and a verified GitHub email or the exact no-reply address from that account's settings:

```sh
git config --local user.name "YOUR COMMIT NAME"
git config --local user.email "YOUR VERIFIED OR GITHUB NO-REPLY EMAIL"
```

The account that authenticates a push and the commit author identity are separate. Choose attribution deliberately; these commands only affect future commits in this checkout.

## Working with both repositories

The [professional](https://github.com/skimuic/UmaLytics) and [community](https://github.com/kjunodev/umalytics) repositories serve different audiences. Keep changes reviewable on a feature branch. This guide does not configure automatic synchronization or change which repository is authoritative.

To inspect the community branch from a fresh professional checkout, first check existing remotes. Add `community` only if that name is unused:

```sh
git remote -v
git remote add community https://github.com/kjunodev/umalytics.git
git fetch origin
git fetch community
git log --oneline --left-right origin/main...community/main
git diff --stat origin/main community/main
```

No log output means the fetched branch tips share the same history. No diff output means their tracked contents match. Fetch again before any synchronization. If either side has unique commits, review them before pushing; do not force-push to make the repositories match. Community pushes require separate write access.

## Troubleshooting

- **PowerShell blocks a pnpm script:** use `pnpm.cmd` in place of `pnpm`, without changing execution policy.
- **Missing WXT-generated types:** rerun `pnpm install --frozen-lockfile` or `pnpm --filter @umalytics/extension exec wxt prepare`.
- **Extension shows stale behavior:** rebuild, reload the extension, refresh the Uma Drafter tab, and reopen the scout window.
- **Scouting data is missing:** check the upstream page, profile privacy/availability, and in-app diagnostics before assuming a build failure.
- **Firefox add-on disappears after restart:** temporary add-ons must be loaded again through `about:debugging`.
