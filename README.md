# ArkStore

An app store for apps that live on GitHub, on Android, Windows, macOS and Linux. Developers link a repo, ArkStore recognizes the app (name, icon, screenshots, description, package, and the installers in its releases) and publishes it. Anyone can install it, and every new GitHub release reaches users as an update, Play Store style.

App Store layouts, Nothing OS materials: dot-matrix type, true black, one red accent.

## What it does

- **Recognizes apps from a repo.** Reads fastlane / Play listing metadata, the README, launcher icons, Gradle config and release assets.
- **Right build for each phone.** Detects the phone's CPU and installs the matching APK (arm64 instead of a 3x larger universal build). Power users can pick another build.
- **Download, then install.** GET downloads the APK with a progress ring, then hands it to Android's installer. Backing out keeps the file (the button becomes INSTALL). After a confirmed install ArkStore offers to delete the installer; stray files are found and listed in Account.
- **Updates.** A Postgres job checks every listing's GitHub releases every 30 minutes. Phones compare with what they installed, in the foreground and in the background, and notify once per release.
- **Honest counts.** Downloads and confirmed installs are counted separately, once per device and version.
- **Publishing is ownership-checked in the database.** Only a repo's owner, or someone with push access (org repos), can publish or claim it.
- **Credit to developers.** Every app page links the developer and asks for a GitHub star.
- **One store per platform.** The Android app lists apps with an APK; the desktop app lists Windows, macOS or Linux apps, whichever it runs on. A release counts when it ships an APK, EXE, MSI, MSIX, DMG, PKG, AppImage, DEB, RPM, Flatpak, or a ZIP / tarball named for its platform.
- **Right installer for each computer.** The desktop app picks the file for the OS and CPU (Apple silicon vs Intel, x64 vs ARM64, `.deb` on Ubuntu, `.rpm` on Fedora, AppImage otherwise), runs it, and keeps the app updated. See `src/lib/github/assets.ts` and `desktop/installer.cjs`.
- **Signed-in devices.** Account lists every phone and computer signed in to your GitHub account, on any platform, with when each was last active. Sign any of them out from any other.
- **Get ArkStore page** (`/download`). Recognizes the device it's opened on, puts the download that works best for it first, and lists the builds for every platform, from ArkStore's newest GitHub release.
- **ArkStore updates itself.** The desktop app with electron-updater (from the release's `latest*.yml`), Android by installing the newest release's APK for the phone's CPU.
- **Featured apps** (`apps.featured`) get App of the Day, the top of the Apps tab, and rank first in search and their category.

## For AI agents

ArkStore has its own MCP server, so Claude Code, Codex, Claude and other MCP clients can use it:

- **Check before building.** `search_apps` finds apps by what they do ("markdown notes with sync", optionally per platform), so an agent can suggest an existing app instead of building one. `get_app` gives the listing and download links.
- **Find MCP servers and plugins.** `search_agent_tools` searches the whole official MCP registry and Claude Code plugin marketplaces (`public.agent_tools`, refreshed overnight with app discovery); `get_install_instructions` gives the exact command for Claude Code, Codex or Claude Desktop. The app shows the same catalog and commands under **Apps → AI agents**.
- **Publish from the agent.** `publish_app` lists the developer's repo (same ownership and release checks as Studio). It needs a personal token from **Account → Connect an AI agent**, sent as `Authorization: Bearer ark_…`. Tokens are stored hashed and can be revoked.

Connect:

```
# Claude Code: plugin (MCP server + a skill that tells Claude when to use ArkStore)
/plugin marketplace add Ark-Devs/ArkStore
/plugin install arkstore@arkstore        # set ARKSTORE_TOKEN to publish

# Claude Code, MCP server only
claude mcp add --transport http arkstore https://<project>.supabase.co/functions/v1/mcp

# Codex
codex mcp add arkstore --url https://<project>.supabase.co/functions/v1/mcp
```

In Claude (desktop or claude.ai), add the URL under Settings → Connectors → Add custom connector (search only: custom connectors can't send the token).

The server is `supabase/functions/mcp` (a Supabase Edge Function, deployed with JWT verification off since MCP clients don't send Supabase JWTs; writes are checked against the token in the database). The plugin is `agent-plugins/arkstore`, listed by `.claude-plugin/marketplace.json`.

## Stack

- Expo SDK 57 (React Native, Expo Router, TypeScript), TanStack Query, Zustand
- Desktop: Electron (`desktop/`) around the Expo web build, electron-builder, electron-updater
- Supabase: Postgres + RLS, Auth (GitHub), Storage, `http` + `pg_cron` for release sync

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Supabase URL and publishable key.
3. Database: run `supabase/setup.sql` in Supabase > SQL Editor (safe to re-run), or apply `supabase/migrations/*` and `supabase/seed.sql` with the Supabase CLI.
4. GitHub sign-in: create a GitHub OAuth app with callback `https://<project>.supabase.co/auth/v1/callback`, enable the GitHub provider in Supabase Auth, and add `arkstore://**`, `exp://**` and your web dev URL to Auth > URL Configuration > Redirect URLs. (The desktop app signs in in the browser and comes back through `arkstore://auth-callback`.)
5. Optional, recommended: give the release sync a GitHub token for 5,000 requests/hour:
   `select vault.create_secret('<token>', 'arkstore_github_token');`

## Run

```bash
npm start          # Expo dev server (Expo Go or a dev build)
npm run web        # browser preview
```

Installing APKs directly needs a real build (`REQUEST_INSTALL_PACKAGES`):

```bash
npx eas-cli build -p android --profile preview
```

## Desktop (Windows, macOS, Linux)

`desktop/` is a small Electron app: it serves the Expo web build (`app://arkstore/`) in a window and gives it a bridge (`window.arkDesktop`, typed in `src/lib/desktop.ts`) for what a browser can't do: download and run installers, open installed apps, sign-in links, notifications and updating itself.

```bash
npm ci --prefix desktop
npm run desktop          # build the web UI and open the desktop app
npm run web & npm run desktop:dev   # or: live reload against the Expo dev server (port 8081)
npm run desktop:dist     # installers for this OS in desktop/dist
```

How each platform installs an app is in `desktop/installer.cjs`: Windows runs `.exe` / `.msi` installers (with the usual admin prompt when they need it); macOS copies the `.app` out of a `.dmg` or `.zip` into Applications; Linux puts AppImages in `~/Applications` with a menu entry and installs `.deb` / `.rpm` through the package manager (pkexec asks for the password).

Signing: without certificates the builds are unsigned. Windows SmartScreen and macOS Gatekeeper then ask people to confirm the first launch, and macOS can't install ArkStore's own updates (the app points to the Get ArkStore page instead). To sign, add repository secrets: `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` (Windows `.pfx`, base64), `CSC_LINK` / `CSC_KEY_PASSWORD` (macOS Developer ID `.p12`, base64) and, to notarize, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Android APKs are signed with the key in `ANDROID_KEYSTORE_BASE64` (plus `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), else the debug key. For the Microsoft Store, set the repository variables `MS_STORE_IDENTITY_NAME`, `MS_STORE_PUBLISHER` and `MS_STORE_PUBLISHER_NAME` (Partner Center → Product identity) and the Windows build also makes an `.appx` to upload.

## Releases

`.github/workflows/android-release.yml` builds the APKs on GitHub and publishes the release:

1. One-time: add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` under Settings > Secrets and variables > Actions.
2. Bump `version` and `android.versionCode` in `app.json`, and write `release-notes/v<version>.md`.
3. Tag and push: `git tag -a v1.2.0 -m "ArkStore 1.2.0" && git push origin v1.2.0`

`.github/workflows/desktop-release.yml` builds on Windows, macOS and Linux runners from the same tag and attaches the installers (plus the `latest*.yml` files the desktop app updates from) to the same release: Windows x64 setup `.exe`, macOS `.dmg` and `.zip` for Apple silicon and Intel, Linux AppImage and `.deb` for x64 and ARM64.

Each release ships one APK per CPU type (`arm64-v8a`, `armeabi-v7a`) plus `universal`. Release builds use R8 and compressed native libraries (see `expo-build-properties` in `app.json`) and per-CPU splits (`plugins/with-abi-splits.js`).

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Database tests (real migrations in PGlite), MCP server tests and GitHub detection tests |
| `npm run typecheck` | App and scripts |
| `npm run discover` | Find trending Android apps with APK releases, write `supabase/seed.sql`. `--only-new <file>` skips repos already listed |
| `npm run db:bundle` | Build `supabase/setup.sql` from migrations + seed |

Curate the seed in `supabase/seed-repos.txt` (always include, set category, `featured`, or `!exclude`).

## Layout

```
src/app/            screens (Expo Router), including download.tsx (Get ArkStore)
src/components/     UI kit (ui/) and store components (store/)
src/lib/            data, installs, updates, auth, devices, GitHub detection
desktop/            Electron shell, platform installers, packaging (electron-builder.yml)
supabase/           migrations, seed, setup.sql, functions/mcp (ArkStore's MCP server)
agent-plugins/      the ArkStore Claude Code plugin (.claude-plugin/marketplace.json lists it)
scripts/            discovery, SQL bundling, icon rendering
tests/              node:test suites
```
