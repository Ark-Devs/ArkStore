# ArkStore

An Android app store for apps that live on GitHub. Developers link a repo, ArkStore recognizes the app (name, icon, screenshots, description, package, APK) and publishes it. Anyone can install it, and every new GitHub release reaches users as an update, Play Store style.

App Store layouts, Nothing OS materials: dot-matrix type, true black, one red accent.

## What it does

- **Recognizes apps from a repo.** Reads fastlane / Play listing metadata, the README, launcher icons, Gradle config and release assets.
- **Right build for each phone.** Detects the phone's CPU and installs the matching APK (arm64 instead of a 3x larger universal build). Power users can pick another build.
- **Download, then install.** GET downloads the APK with a progress ring, then hands it to Android's installer. Backing out keeps the file (the button becomes INSTALL). After a confirmed install ArkStore offers to delete the installer; stray files are found and listed in Account.
- **Updates.** A Postgres job checks every listing's GitHub releases every 30 minutes. Phones compare with what they installed, in the foreground and in the background, and notify once per release.
- **Honest counts.** Downloads and confirmed installs are counted separately, once per device and version.
- **Publishing is ownership-checked in the database.** Only a repo's owner, or someone with push access (org repos), can publish or claim it.
- **Credit to developers.** Every app page links the developer and asks for a GitHub star.
- **Featured apps** (`apps.featured`) get App of the Day, the top of the Apps tab, and rank first in search and their category.

## Stack

- Expo SDK 57 (React Native, Expo Router, TypeScript), TanStack Query, Zustand
- Supabase: Postgres + RLS, Auth (GitHub), Storage, `http` + `pg_cron` for release sync

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Supabase URL and publishable key.
3. Database: run `supabase/setup.sql` in Supabase > SQL Editor (safe to re-run), or apply `supabase/migrations/*` and `supabase/seed.sql` with the Supabase CLI.
4. GitHub sign-in: create a GitHub OAuth app with callback `https://<project>.supabase.co/auth/v1/callback`, enable the GitHub provider in Supabase Auth, and add `arkstore://**`, `exp://**` and your web dev URL to Auth > URL Configuration > Redirect URLs.
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

## Releases

`.github/workflows/android-release.yml` builds the APKs on GitHub and publishes the release:

1. One-time: add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` under Settings > Secrets and variables > Actions.
2. Bump `version` and `android.versionCode` in `app.json`, and write `release-notes/v<version>.md`.
3. Tag and push: `git tag -a v1.2.0 -m "ArkStore 1.2.0" && git push origin v1.2.0`

Each release ships one APK per CPU type (`arm64-v8a`, `armeabi-v7a`) plus `universal`. Release builds use R8 and compressed native libraries (see `expo-build-properties` in `app.json`) and per-CPU splits (`plugins/with-abi-splits.js`).

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Database tests (real migrations in PGlite) and GitHub detection tests |
| `npm run typecheck` | App and scripts |
| `npm run discover` | Find trending Android apps with APK releases, write `supabase/seed.sql`. `--only-new <file>` skips repos already listed |
| `npm run db:bundle` | Build `supabase/setup.sql` from migrations + seed |

Curate the seed in `supabase/seed-repos.txt` (always include, set category, `featured`, or `!exclude`).

## Layout

```
src/app/            screens (Expo Router)
src/components/     UI kit (ui/) and store components (store/)
src/lib/            data, installs, updates, auth, GitHub detection
supabase/           migrations, seed, setup.sql
scripts/            discovery, SQL bundling, icon rendering
tests/              node:test suites
```
