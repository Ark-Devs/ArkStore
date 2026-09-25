import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { chooseApkForDevice, pickApk } from '../src/lib/github/apk';
import { bestAsset, installableAssets, platformsOf, rankAssets, type ReleaseFile } from '../src/lib/github/assets';
import { suggestCategory } from '../src/lib/github/category';
import {
  installableReleases,
  currentRelease,
  detectRepo,
  prettifyRepoName,
  type GitHubRelease,
} from '../src/lib/github/detect';
import { readmeImages, readmeSummary, resolveImageUrl } from '../src/lib/github/markdown';
import { parseRepoInput } from '../src/lib/github/repo';

describe('parseRepoInput', () => {
  test('handles the ways people paste a repo', () => {
    assert.equal(parseRepoInput('git@github.com:Ark-Devs/DB-Crawler.git')?.fullName, 'Ark-Devs/DB-Crawler');
    assert.equal(parseRepoInput('https://github.com/Ark-Devs/DB-Crawler')?.fullName, 'Ark-Devs/DB-Crawler');
    assert.equal(parseRepoInput('github.com/TeamNewPipe/NewPipe/releases')?.fullName, 'TeamNewPipe/NewPipe');
    assert.equal(parseRepoInput('  alice/notes  ')?.fullName, 'alice/notes');
    assert.equal(parseRepoInput('https://github.com/alice/notes?tab=readme')?.fullName, 'alice/notes');
    assert.equal(parseRepoInput('https://gitlab.com/a/b'), null);
    assert.equal(parseRepoInput('just words'), null);
    assert.equal(parseRepoInput('alice/..'), null);
  });
});

describe('pickApk (mirrors the SQL version)', () => {
  const pick = (names: string[]) =>
    pickApk(names.map((name) => ({ name, size: 10, browser_download_url: `https://x/${name}` })))?.name ?? '';

  test('ranks universal > ABI-less > arm64 > other ABIs, debug last', () => {
    assert.equal(pick(['a-arm64-v8a.apk', 'a-universal.apk', 'a-x86.apk']), 'a-universal.apk');
    assert.equal(pick(['a-armeabi-v7a.apk', 'a-arm64-v8a.apk']), 'a-arm64-v8a.apk');
    assert.equal(pick(['a-debug.apk', 'a-arm64-v8a.apk']), 'a-arm64-v8a.apk');
    assert.equal(pick(['app-release.apk', 'app-arm64-v8a-release.apk']), 'app-release.apk');
    assert.equal(pick(['notes.zip', 'checksums.txt', 'bundle.apks']), '');
  });
});

describe('chooseApkForDevice', () => {
  // DB-Crawler's real release layout.
  const assets = [
    { name: 'db-crawler-v0.1.0-beta-arm64-v8a.apk', size: 13_656_321, url: 'https://dl/arm64' },
    { name: 'db-crawler-v0.1.0-beta-armeabi-v7a.apk', size: 13_323_371, url: 'https://dl/v7a' },
    { name: 'db-crawler-v0.1.0-beta-universal.apk', size: 39_615_440, url: 'https://dl/universal' },
    { name: 'db-crawler-v0.1.0-beta-x86_64.apk', size: 14_106_724, url: 'https://dl/x86_64' },
  ];

  test('modern phones get the arm64 build, not the 3x larger universal one', () => {
    assert.equal(chooseApkForDevice(assets, ['arm64-v8a', 'armeabi-v7a', 'armeabi'])?.url, 'https://dl/arm64');
  });
  test('older 32-bit phones and emulators get their own build', () => {
    assert.equal(chooseApkForDevice(assets, ['armeabi-v7a', 'armeabi'])?.url, 'https://dl/v7a');
    assert.equal(chooseApkForDevice(assets, ['x86_64', 'x86'])?.url, 'https://dl/x86_64');
  });
  test('falls back to universal when nothing matches or the ABI is unknown', () => {
    assert.equal(chooseApkForDevice(assets, ['riscv64'])?.url, 'https://dl/universal');
    assert.equal(chooseApkForDevice(assets, null)?.url, 'https://dl/universal');
  });
  test('single-APK releases always use that APK', () => {
    const one = [{ name: 'NewPipe_v0.27.apk', size: 10, url: 'https://dl/np' }];
    assert.equal(chooseApkForDevice(one, ['arm64-v8a'])?.url, 'https://dl/np');
  });
});

describe('suggestCategory', () => {
  test('topics outweigh incidental words', () => {
    assert.equal(suggestCategory({ topics: ['music-player', 'music'], description: 'Play files from storage' }), 'music-audio');
    assert.equal(suggestCategory({ topics: ['launcher'], name: 'lawnchair' }), 'personalization');
    assert.equal(suggestCategory({ topics: ['2fa', 'totp'], description: 'Authenticator' }), 'security');
    assert.equal(suggestCategory({ name: 'DB-Crawler', description: 'A database crawler' }), 'developer');
    assert.equal(suggestCategory({ name: 'thing', description: 'does stuff' }), 'tools');
  });
});

describe('README parsing', () => {
  const md = `
<p align="center"><img src="art/logo.png" width="120"></p>

# NotesApp [![Build](https://github.com/a/b/actions/workflows/ci.yml/badge.svg)](x)

[![F-Droid](https://fdroid.gitlab.io/artwork/badge/get-it-on.png)](https://f-droid.org)

A tiny, **offline-first** notes app for Android. No accounts, no ads, no tracking.

## Features
- Markdown
- Encrypted \`backups\`

| Light | Dark |
|---|---|
| ![](docs/shot-1.png) | <img src="https://user-images.githubusercontent.com/1/dark.png"> |

\`\`\`kotlin
val x = 1
\`\`\`
`;
  const base = 'https://raw.githubusercontent.com/a/b/main';

  test('summary keeps prose and lists, drops badges, tables and code', () => {
    const s = readmeSummary(md);
    assert.match(s, /^A tiny, offline-first notes app for Android\./);
    assert.match(s, /• Markdown\n• Encrypted backups/);
    assert.doesNotMatch(s, /badge|kotlin|\|/);
  });

  test('images skip badges and logos, resolve relative paths', () => {
    assert.deepEqual(readmeImages(md, base), [
      'https://raw.githubusercontent.com/a/b/main/docs/shot-1.png',
      'https://user-images.githubusercontent.com/1/dark.png',
    ]);
  });

  test('blob links become raw links', () => {
    assert.equal(
      resolveImageUrl('https://github.com/a/b/blob/main/img/s.png?raw=true', base),
      'https://raw.githubusercontent.com/a/b/main/img/s.png',
    );
    assert.equal(resolveImageUrl('/img/s.png', `${base}/docs`), 'https://raw.githubusercontent.com/a/b/main/img/s.png');
  });
});

describe('release helpers', () => {
  test('prettifyRepoName', () => {
    assert.equal(prettifyRepoName('DB-Crawler'), 'DB Crawler');
    assert.equal(prettifyRepoName('thunderbird-android'), 'Thunderbird');
    assert.equal(prettifyRepoName('NewPipe'), 'NewPipe');
    assert.equal(prettifyRepoName('material_files'), 'Material Files');
    assert.equal(prettifyRepoName('web-to-app'), 'Web To App');
  });

  test('installableReleases skips drafts and releases with nothing to install; currentRelease prefers stable', () => {
    const rel = (tag: string, extra: Partial<GitHubRelease> = {}, assets = [`${tag}.apk`]): GitHubRelease => ({
      tag_name: tag,
      name: tag,
      body: '',
      draft: false,
      prerelease: false,
      published_at: '2026-01-01T00:00:00Z',
      html_url: '',
      assets: assets.map((name) => ({ name, size: 1, browser_download_url: name })),
      ...extra,
    });
    const out = installableReleases([
      rel('v3', { prerelease: true, published_at: '2026-03-01T00:00:00Z' }),
      rel('v2.1', { published_at: '2026-02-01T00:00:00Z' }, ['server.tar.gz']),
      rel('v2', { published_at: '2026-02-01T00:00:00Z' }),
      rel('v1.9', { draft: true, published_at: '2026-01-15T00:00:00Z' }),
      rel('v1'),
    ]);
    assert.deepEqual(out.map((r) => r.version), ['v3', 'v2', 'v1']);
    assert.equal(currentRelease(out)?.version, 'v2', 'stable wins over a newer beta');

    const betasOnly = installableReleases([
      rel('v0.2-beta', { prerelease: true, published_at: '2026-02-01T00:00:00Z' }),
      rel('v0.1-beta', { prerelease: true }),
    ]);
    const current = currentRelease(betasOnly);
    assert.equal(current?.version, 'v0.2-beta', 'beta-only projects still get listed');
    assert.equal(current?.prerelease, true);
  });
});

describe('detectRepo', () => {
  test('recognizes fastlane metadata, icon, screenshots, package and APK', async () => {
    const tree = [
      'README.md',
      'app/build.gradle.kts',
      'app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp',
      'fastlane/metadata/android/de-DE/title.txt',
      'fastlane/metadata/android/en-US/title.txt',
      'fastlane/metadata/android/en-US/short_description.txt',
      'fastlane/metadata/android/en-US/full_description.txt',
      'fastlane/metadata/android/en-US/images/icon.png',
      'fastlane/metadata/android/en-US/images/phoneScreenshots/10.png',
      'fastlane/metadata/android/en-US/images/phoneScreenshots/2.png',
      'fastlane/metadata/android/en-US/images/tenInchScreenshots/1.png',
    ].map((path) => ({ path, type: 'blob' }));

    const files: Record<string, string> = {
      'fastlane/metadata/android/en-US/title.txt': 'DB Crawler\n',
      'fastlane/metadata/android/en-US/short_description.txt': 'Browse any database from your phone',
      'fastlane/metadata/android/en-US/full_description.txt': '<p>Connect to <b>Postgres</b>.</p><ul><li>Fast</li></ul>',
      'README.md': '# DB Crawler\n\nA database crawler for Android phones and tablets.',
      'app/build.gradle.kts': 'android {\n  namespace = "dev.ark.dbcrawler"\n  defaultConfig {\n    applicationId = "dev.ark.dbcrawler"\n    minSdk = 26\n  }\n}',
    };

    const requested: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url === 'https://api.github.com/repos/Ark-Devs/DB-Crawler') {
        return json({
          full_name: 'Ark-Devs/DB-Crawler',
          name: 'DB-Crawler',
          description: 'Database crawler',
          html_url: 'https://github.com/Ark-Devs/DB-Crawler',
          homepage: null,
          stargazers_count: 12,
          topics: ['database', 'android'],
          default_branch: 'main',
          private: false,
          owner: { login: 'Ark-Devs', avatar_url: 'https://avatars/ark' },
        });
      }
      if (url.includes('/releases?')) {
        return json([
          {
            tag_name: 'v0.3.0',
            name: 'v0.3.0',
            body: 'Faster crawling',
            draft: false,
            prerelease: false,
            published_at: '2026-09-01T00:00:00Z',
            html_url: '',
            assets: [
              { name: 'db-crawler-arm64-v8a.apk', size: 5, browser_download_url: 'https://dl/arm64.apk' },
              { name: 'db-crawler-universal.apk', size: 9, browser_download_url: 'https://dl/universal.apk' },
            ],
          },
        ]);
      }
      if (url.includes('/git/trees/')) return json({ tree });
      const rawPrefix = 'https://raw.githubusercontent.com/Ark-Devs/DB-Crawler/main/';
      if (url.startsWith(rawPrefix)) {
        const body = files[decodeURIComponent(url.slice(rawPrefix.length))];
        return body === undefined ? new Response('', { status: 404 }) : new Response(body, { status: 200 });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const d = await detectRepo(parseRepoInput('git@github.com:Ark-Devs/DB-Crawler.git')!, { fetch: fakeFetch });

    assert.equal(d.name, 'DB Crawler');
    assert.equal(d.subtitle, 'Browse any database from your phone');
    assert.match(d.description, /Connect to Postgres\./);
    assert.match(d.description, /• Fast/);
    assert.equal(d.metadataSource, 'fastlane');
    assert.equal(d.category, 'developer');
    assert.equal(d.packageName, 'dev.ark.dbcrawler');
    assert.equal(d.minSdk, 26);
    assert.equal(d.release?.version, 'v0.3.0');
    assert.equal(d.release?.apk?.name, 'db-crawler-universal.apk');
    assert.equal(
      d.iconCandidates[0],
      'https://raw.githubusercontent.com/Ark-Devs/DB-Crawler/main/fastlane/metadata/android/en-US/images/icon.png',
    );
    assert.equal(d.iconCandidates.at(-1), 'https://avatars/ark');
    assert.deepEqual(
      d.screenshotCandidates.map((u) => u.split('/').pop()),
      ['2.png', '10.png'],
      'phone screenshots only, natural order',
    );
    assert.ok(!requested.some((u) => u.includes('api.github.com') && u.includes('/readme')), 'README read via raw');
  });
});

describe('desktop builds', () => {
  const files = (names: string[]): ReleaseFile[] =>
    installableAssets(names.map((name, i) => ({ name, size: 100 + i, browser_download_url: `https://x/${name}` })));
  const electronRelease = files([
    'App-Setup-1.0.0.exe',
    'App-1.0.0-arm64-setup.exe',
    'App-1.0.0-portable.exe',
    'App-1.0.0-x64.msi',
    'App-1.0.0-x64.dmg',
    'App-1.0.0-arm64.dmg',
    'App-1.0.0-mac-arm64.zip',
    'App-1.0.0-x86_64.AppImage',
    'App-1.0.0-arm64.AppImage',
    'app_1.0.0_amd64.deb',
    'app-1.0.0.x86_64.rpm',
    'app-release.apk',
    'latest.yml',
    'App-Setup-1.0.0.exe.blockmap',
  ]);
  const pick = (os: any, arch: any, linuxPackage: any = null) => bestAsset(electronRelease, { os, arch, linuxPackage })?.name;

  test('checksums, update manifests and blockmaps are not installers', () => {
    assert.equal(electronRelease.length, 12);
    assert.deepEqual(platformsOf(electronRelease), ['android', 'windows', 'macos', 'linux']);
  });

  test('Windows gets the installer for its CPU, not the portable build', () => {
    assert.equal(pick('windows', 'x64'), 'App-Setup-1.0.0.exe');
    assert.equal(pick('windows', 'arm64'), 'App-1.0.0-arm64-setup.exe');
    assert.equal(pick('windows', null), 'App-Setup-1.0.0.exe');
  });

  test('Macs get the disk image for their chip, Intel builds as a fallback on Apple silicon', () => {
    assert.equal(pick('macos', 'arm64'), 'App-1.0.0-arm64.dmg');
    assert.equal(pick('macos', 'x64'), 'App-1.0.0-x64.dmg');
    const intelOnly = files(['Old-1.0-x64.dmg']);
    assert.equal(bestAsset(intelOnly, { os: 'macos', arch: 'arm64' })?.name, 'Old-1.0-x64.dmg', 'Rosetta runs it');
  });

  test('Linux prefers the AppImage, or the distro package format when known', () => {
    assert.equal(pick('linux', 'x64'), 'App-1.0.0-x86_64.AppImage');
    assert.equal(pick('linux', 'arm64'), 'App-1.0.0-arm64.AppImage');
    assert.equal(pick('linux', 'x64', 'deb'), 'app_1.0.0_amd64.deb');
    assert.equal(pick('linux', 'x64', 'rpm'), 'app-1.0.0.x86_64.rpm');
    // An x64 .deb must never be offered to an ARM machine.
    assert.ok(!rankAssets(electronRelease, { os: 'linux', arch: 'arm64' }).some((f) => f.name.endsWith('.deb')));
  });

  test('nothing for a platform means no pick', () => {
    assert.equal(bestAsset(files(['a.apk']), { os: 'windows', arch: 'x64' }), null);
  });
});
