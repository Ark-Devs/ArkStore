// ArkStore keeping itself up to date. ArkStore ships from its own GitHub releases:
//   desktop  electron-updater downloads the new version in the background (desktop/main.cjs);
//            the app shows "Restart to update" when it's ready
//   Android  the app checks the newest release, downloads the APK for this phone's CPU and
//            hands it to Android's installer, like any other app
// The download page (src/app/download.tsx) reads the same release.
import { useQuery } from '@tanstack/react-query';
import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { desktop, type SelfUpdateStatus } from './desktop';
import { deviceAbis } from './device';
import { chooseApkForDevice } from './github/apk';
import { installableAssets, type ReleaseFile } from './github/assets';
import { launchInstaller } from './install';

/** Where ArkStore's own releases live. Forks can point this at their repo. */
export const ARKSTORE_REPO = process.env.EXPO_PUBLIC_ARKSTORE_REPO || 'Ark-Devs/ArkStore';

export type ArkStoreRelease = {
  version: string;
  tag: string;
  notes: string;
  publishedAt: string | null;
  url: string;
  files: ReleaseFile[];
};

/** The newest ArkStore release on GitHub (never drafts or prereleases). */
export async function fetchLatestArkStore(): Promise<ArkStoreRelease | null> {
  const res = await fetch(`https://api.github.com/repos/${ARKSTORE_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const r = (await res.json()) as {
    tag_name: string;
    body: string | null;
    published_at: string | null;
    html_url: string;
    assets: { name: string; size: number; browser_download_url: string }[];
  };
  return {
    version: r.tag_name.replace(/^v/i, ''),
    tag: r.tag_name,
    notes: (r.body ?? '').trim(),
    publishedAt: r.published_at,
    url: r.html_url,
    files: installableAssets(r.assets),
  };
}

export function useLatestArkStore(enabled = true) {
  return useQuery({
    queryKey: ['arkstore-latest'],
    queryFn: fetchLatestArkStore,
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

/** 1.10.0 > 1.9.2; prerelease suffixes are ignored. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export const currentArkStoreVersion = () => desktop?.appVersion ?? Application.nativeApplicationVersion ?? null;

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

export function useDesktopUpdate(): SelfUpdateStatus | null {
  const [status, setStatus] = useState<SelfUpdateStatus | null>(null);
  useEffect(() => {
    if (!desktop) return;
    desktop.update.status().then(setStatus).catch(() => undefined);
    return desktop.update.onStatus(setStatus);
  }, []);
  return status;
}

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------

type AndroidUpdate = { status: 'idle' | 'downloading' | 'installing' | 'error'; progress: number; error?: string };
export const useAndroidSelfUpdate = create<AndroidUpdate>()(() => ({ status: 'idle', progress: 0 }));

/** The APK of a release that fits this phone. */
export function apkForThisPhone(release: ArkStoreRelease) {
  const apks = release.files.filter((f) => f.os === 'android');
  return apks.length ? chooseApkForDevice(apks, deviceAbis()) : null;
}

/** Whether this Android install of ArkStore can update itself to `release`. */
export function androidUpdateAvailable(release: ArkStoreRelease | null | undefined): boolean {
  const current = Application.nativeApplicationVersion;
  return Boolean(
    Platform.OS === 'android' && release && current && isNewerVersion(release.version, current) && apkForThisPhone(release),
  );
}

export async function updateArkStoreOnAndroid(release: ArkStoreRelease) {
  const apk = apkForThisPhone(release);
  if (!apk) throw new Error('This release has no APK for this phone.');
  const set = useAndroidSelfUpdate.setState;
  set({ status: 'downloading', progress: 0, error: undefined });
  const target = new File(Paths.cache, `ArkStore-${release.version}-${apk.name}`.replace(/[^A-Za-z0-9._-]/g, '_'));
  try {
    const file = await File.downloadFileAsync(apk.url, target, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : apk.size;
        set({ progress: total > 0 ? Math.min(1, bytesWritten / total) : -1 });
      },
    });
    set({ status: 'installing', progress: 1 });
    // Android replaces the running app and restarts it once the person confirms.
    await launchInstaller(file.uri);
    set({ status: 'idle', progress: 0 });
  } catch (e) {
    set({ status: 'error', progress: 0, error: (e as Error).message });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// One answer for every platform: is a newer ArkStore out, and what does the button do?
// ---------------------------------------------------------------------------

export type ArkStoreUpdate =
  /** Android: download the new APK and hand it to the installer. */
  | { kind: 'install'; version: string; notes: string; release: ArkStoreRelease }
  /** Desktop: electron-updater is fetching it in the background. */
  | { kind: 'downloading'; version: string; progress: number }
  /** Desktop: downloaded, a restart finishes the update. */
  | { kind: 'restart'; version: string; notes: string }
  /** Desktop builds that can't replace themselves (unsigned Mac, MSI, manual installs): get it from the download page. */
  | { kind: 'download'; version: string; notes: string };

const HOUR = 60 * 60 * 1000;

/** Whether a newer ArkStore release is out for this device. Rechecks GitHub every hour. */
export function useArkStoreUpdate(): ArkStoreUpdate | null {
  const inApp = Boolean(desktop) || Platform.OS === 'android';
  const latest = useQuery({
    queryKey: ['arkstore-latest'],
    queryFn: fetchLatestArkStore,
    enabled: inApp,
    staleTime: HOUR,
    refetchInterval: HOUR,
    retry: 1,
  });
  const status = useDesktopUpdate();
  const release = latest.data;

  if (desktop) {
    if (status?.state === 'ready') return { kind: 'restart', version: status.version, notes: plain(status.notes) };
    if (status?.state === 'downloading') return { kind: 'downloading', version: status.version, progress: status.progress };
    if (status?.state === 'available') return { kind: 'downloading', version: status.version, progress: 0 };
    const hasBuild = release?.files.some((f) => f.os === desktop!.os);
    if (release && hasBuild && isNewerVersion(release.version, desktop.appVersion)) {
      return { kind: 'download', version: release.version, notes: release.notes };
    }
    return null;
  }
  if (androidUpdateAvailable(release)) return { kind: 'install', version: release!.version, notes: release!.notes, release: release! };
  return null;
}

const plain = (notes: string | null | undefined) => (notes ?? '').trim();
