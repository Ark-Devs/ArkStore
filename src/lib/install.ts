// Get / Install / Update / Open, as two separate steps:
//   1. download  the APK built for this phone into ArkStore's installers folder
//                (counted as a download; the file is remembered)
//   2. install   hand that file to Android's package installer
//                (counted as an install/update once Android confirms)
// If the person backs out of the installer, the file stays and the button becomes INSTALL.
// Once an install is confirmed the file isn't needed: ArkStore asks to delete it (or does,
// per the person's setting), and reconcileInstallers() tidies up anything left behind.
// The desktop app follows the same two steps with the platform's installer (see the Desktop
// section below and desktop/installer.cjs).
import { Directory, File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as IntentLauncher from 'expo-intent-launcher';
import { Alert, Linking, Platform } from 'react-native';

import { recordDownload } from './api';
import { desktop } from './desktop';
import { chooseBuild, pickDownload } from './device';
import { fileSize } from './format';
import { useInstalled } from './stores/installed';
import { installerStatus, isNeeded, useInstallers, type InstallerFile } from './stores/installers';
import { usePrefs } from './stores/prefs';
import { useTasks } from './stores/tasks';
import type { ListApp } from './types';

const INSTALL_PACKAGE = 'android.intent.action.INSTALL_PACKAGE';
const VIEW = 'android.intent.action.VIEW';
const APK_MIME = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export type InstallOutcome = 'installed' | 'cancelled' | 'handed-off' | 'downloaded';

const installersDir = () => {
  const dir = new Directory(Paths.document, 'installers');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
};

const count = (appId: string, kind: 'download' | 'install' | 'update', version: string | null) =>
  recordDownload(appId, usePrefs.getState().deviceId, kind, version).catch(() => undefined);

// ---------------------------------------------------------------------------
// Packages on the phone
// ---------------------------------------------------------------------------

export async function isPackageInstalled(packageName: string | null | undefined): Promise<boolean> {
  if (Platform.OS !== 'android' || !packageName) return false;
  try {
    await IntentLauncher.getApplicationIconAsync(packageName);
    return true;
  } catch {
    return false;
  }
}

/** OPEN: launches an installed app. False when ArkStore doesn't know how to open it. */
export function openApp(app: Pick<ListApp, 'id' | 'package_name'>): boolean {
  if (desktop) {
    const path = useInstalled.getState().apps[app.id]?.launchPath;
    if (!path) return false;
    desktop.launch(path).catch(() => undefined);
    return true;
  }
  return openInstalledApp(app.package_name);
}

/** Whether OPEN can work for an installed app on this device. */
export function canOpen(app: Pick<ListApp, 'id' | 'package_name'>, launchPath?: string | null): boolean {
  if (desktop) return Boolean(launchPath);
  return Platform.OS === 'android' && Boolean(app.package_name);
}

export function openInstalledApp(packageName: string | null | undefined): boolean {
  if (Platform.OS !== 'android' || !packageName) return false;
  try {
    IntentLauncher.openApplication(packageName);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Installer files
// ---------------------------------------------------------------------------

function deleteFile(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

export function deleteInstaller(appId: string) {
  const file = useInstallers.getState().files[appId];
  if (file && desktop) desktop.remove(file.uri).catch(() => undefined);
  else if (file) deleteFile(file.uri);
  useInstallers.getState().remove(appId);
}

/** The downloaded APK for the app's current release, if it is still on disk. */
export function readyInstaller(app: Pick<ListApp, 'id' | 'latest_version'>): InstallerFile | null {
  const file = useInstallers.getState().files[app.id];
  if (!file || file.version !== app.latest_version) return null;
  const installed = useInstalled.getState().apps[app.id];
  return isNeeded(installerStatus(file, installed)) ? file : null;
}

export type LooseFile = { uri: string; name: string; size: number };

/**
 * Matches the installers folder with what ArkStore remembers and what the phone has:
 * forgets records whose file is gone, notices installs that finished outside the app
 * (e.g. the person installed from the notification shade), deletes files the person asked
 * us to always clean up, and returns files on disk that nothing refers to.
 */
export async function reconcileInstallers(): Promise<LooseFile[]> {
  if (Platform.OS === 'web') return [];
  const { files, remove } = useInstallers.getState();
  const cleanup = usePrefs.getState().installerCleanup;

  for (const file of Object.values(files)) {
    if (!new File(file.uri).exists) {
      remove(file.appId);
      continue;
    }
    const installed = useInstalled.getState().apps[file.appId];
    if (!installed && (await isPackageInstalled(file.packageName))) {
      useInstalled.getState().markInstalled({
        appId: file.appId,
        name: file.name,
        iconUrl: file.iconUrl,
        packageName: file.packageName,
        version: file.version,
        publishedAt: file.publishedAt,
        assetName: file.assetName,
        installedAt: new Date().toISOString(),
      });
      await count(file.appId, 'install', file.version);
    }
    const status = installerStatus(file, useInstalled.getState().apps[file.appId]);
    if (!isNeeded(status) && cleanup === 'delete') deleteInstaller(file.appId);
  }

  const known = new Set(Object.values(useInstallers.getState().files).map((f) => f.uri));
  const loose: LooseFile[] = [];
  for (const entry of installersDir().list()) {
    if (entry instanceof File && !known.has(entry.uri)) {
      loose.push({ uri: entry.uri, name: entry.name, size: entry.size ?? 0 });
    }
  }
  return loose;
}

export function deleteLooseFile(uri: string) {
  deleteFile(uri);
}

/** After a confirmed install: the APK has done its job. Ask (or follow the setting). */
function offerCleanup(file: InstallerFile) {
  const pref = usePrefs.getState().installerCleanup;
  if (pref === 'delete') return deleteInstaller(file.appId);
  if (pref === 'keep') return;
  Alert.alert(
    `${file.name} is installed`,
    `The ${fileSize(file.size)} installer file isn't needed anymore. Delete it to free up space?`,
    [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Always delete',
        onPress: () => {
          usePrefs.getState().setInstallerCleanup('delete');
          deleteInstaller(file.appId);
        },
      },
      { text: 'Delete', style: 'destructive', onPress: () => deleteInstaller(file.appId) },
    ],
  );
}

// ---------------------------------------------------------------------------
// Step 1: download
// ---------------------------------------------------------------------------

export async function downloadApp(app: ListApp): Promise<InstallerFile | null> {
  const existing = readyInstaller(app);
  if (existing && new File(existing.uri).exists) return existing;

  const override = usePrefs.getState().buildOverride[app.id];
  const build = chooseBuild(app.apk_assets, { name: app.apk_name, url: app.apk_url, size: app.apk_size }, override);
  if (!build || !app.latest_version) throw new Error('This app has no downloadable release yet.');

  const controller = new AbortController();
  useTasks.getState().set(app.id, { status: 'downloading', progress: 0, abort: () => controller.abort() });
  const safe = `${app.id}-${app.latest_version}-${build.asset.name}`.replace(/[^A-Za-z0-9._-]/g, '_');
  const target = new File(installersDir(), safe);

  const startedAt = Date.now();
  try {
    const file = await File.downloadFileAsync(build.asset.url, target, {
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : build.asset.size;
        const elapsed = (Date.now() - startedAt) / 1000;
        // Wait a second before estimating so connection setup doesn't skew the speed.
        const speed = elapsed >= 1 && bytesWritten > 0 ? bytesWritten / elapsed : null;
        const eta = speed && total > 0 ? Math.max(0, (total - bytesWritten) / speed) : null;
        useTasks.getState().progress(app.id, total > 0 ? Math.min(1, bytesWritten / total) : -1, eta);
      },
    });
    const seconds = (Date.now() - startedAt) / 1000;
    const bytes = file.size || build.asset.size;
    if (seconds >= 1 && bytes >= 512 * 1024) usePrefs.getState().recordDownloadSpeed(bytes / seconds);
    const entry: InstallerFile = {
      appId: app.id,
      name: app.name,
      iconUrl: app.icon_url,
      packageName: app.package_name,
      version: app.latest_version,
      publishedAt: app.latest_published_at,
      assetName: build.asset.name,
      uri: file.uri,
      size: file.size || build.asset.size,
      downloadedAt: new Date().toISOString(),
    };
    // A newer download replaces the older installer for the same app.
    const replaced = useInstallers.getState().put(entry);
    if (replaced) deleteFile(replaced.uri);
    await count(app.id, 'download', app.latest_version);
    return entry;
  } catch (e) {
    deleteFile(target.uri);
    if ((e as Error).name === 'AbortError') return null;
    useTasks.getState().set(app.id, { status: 'error', progress: 0, error: (e as Error).message });
    throw e;
  } finally {
    if (useTasks.getState().tasks[app.id]?.status === 'downloading') useTasks.getState().set(app.id, null);
  }
}

// ---------------------------------------------------------------------------
// Step 2: install
// ---------------------------------------------------------------------------

export async function launchInstaller(uri: string): Promise<boolean | null> {
  const contentUri = new File(uri).contentUri;
  try {
    const result = await IntentLauncher.startActivityAsync(INSTALL_PACKAGE, {
      data: contentUri,
      type: APK_MIME,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
      extra: {
        'android.intent.extra.RETURN_RESULT': true,
        'android.intent.extra.NOT_UNKNOWN_SOURCE': true,
      },
    });
    return result.resultCode === IntentLauncher.ResultCode.Success;
  } catch {
    // Some runtimes (e.g. Expo Go) can't use INSTALL_PACKAGE; the viewer intent still opens
    // the installer but doesn't report back. reconcileInstallers() catches the result later.
    await IntentLauncher.startActivityAsync(VIEW, { data: contentUri, type: APK_MIME, flags: FLAG_GRANT_READ_URI_PERMISSION });
    return null;
  }
}

export async function installFromFile(file: InstallerFile, kind: 'install' | 'update'): Promise<InstallOutcome> {
  if (desktop) return desktopInstall(file, kind);
  if (!new File(file.uri).exists) {
    useInstallers.getState().remove(file.appId);
    throw new Error('The downloaded file is gone. Tap Get to download it again.');
  }
  useTasks.getState().set(file.appId, { status: 'installing', progress: 1 });
  try {
    const confirmed = await launchInstaller(file.uri);
    const installed = confirmed ?? (kind === 'install' ? await isPackageInstalled(file.packageName) : false);
    if (!installed) return confirmed === null ? 'handed-off' : 'cancelled';

    useInstalled.getState().markInstalled({
      appId: file.appId,
      name: file.name,
      iconUrl: file.iconUrl,
      packageName: file.packageName,
      version: file.version,
      publishedAt: file.publishedAt,
      assetName: file.assetName,
      installedAt: new Date().toISOString(),
    });
    await count(file.appId, kind, file.version);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    offerCleanup(file);
    return 'installed';
  } finally {
    useTasks.getState().set(file.appId, null);
  }
}

/** GET / UPDATE: download (or reuse the file already downloaded), then install. */
export async function installApp(app: ListApp, kind: 'install' | 'update'): Promise<InstallOutcome> {
  const busy = useTasks.getState().tasks[app.id]?.status;
  if (busy === 'downloading' || busy === 'installing') return 'cancelled';
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

  if (desktop) {
    const file = await desktopDownload(app);
    if (!file) return 'cancelled';
    return desktopInstall(file, kind);
  }

  if (Platform.OS !== 'android') {
    // Browsers and iPhones can't install anything: hand the file for the visitor's device
    // (or the APK, to put on a phone) to the browser as a download.
    const build = pickDownload(app, usePrefs.getState().buildOverride[app.id]);
    if (!build) throw new Error('This app has no downloadable release yet.');
    await Linking.openURL(build.url);
    await count(app.id, 'download', app.latest_version);
    return 'downloaded';
  }

  const file = await downloadApp(app);
  if (!file) return 'cancelled';
  return installFromFile(file, kind);
}

export function cancelDownload(appId: string) {
  useTasks.getState().tasks[appId]?.abort?.();
  useTasks.getState().set(appId, null);
}

// ---------------------------------------------------------------------------
// Desktop (Windows, macOS, Linux): the Electron shell downloads into its installers folder
// and runs the platform's installer (see desktop/installer.cjs).
// ---------------------------------------------------------------------------

async function desktopDownload(app: ListApp): Promise<InstallerFile | null> {
  const bridge = desktop!;
  const existing = readyInstaller(app);
  if (existing && (await bridge.exists(existing.uri))) return existing;

  const pick = pickDownload(app, usePrefs.getState().buildOverride[app.id]);
  if (!pick || !app.latest_version) throw new Error(`${app.name} has no build for this computer yet.`);

  useTasks.getState().set(app.id, { status: 'downloading', progress: 0, abort: () => bridge.cancelDownload(app.id) });
  const startedAt = Date.now();
  const stop = bridge.onDownloadProgress((id, received, totalBytes) => {
    if (id !== app.id) return;
    const total = totalBytes > 0 ? totalBytes : pick.size;
    const elapsed = (Date.now() - startedAt) / 1000;
    const speed = elapsed >= 1 && received > 0 ? received / elapsed : null;
    const eta = speed && total > 0 ? Math.max(0, (total - received) / speed) : null;
    useTasks.getState().progress(app.id, total > 0 ? Math.min(1, received / total) : -1, eta);
  });

  try {
    const safe = `${app.id}-${app.latest_version}-${pick.name}`.replace(/[^A-Za-z0-9._-]/g, '_');
    const result = await bridge.download(app.id, pick.url, safe);
    if (!result) return null;
    const seconds = (Date.now() - startedAt) / 1000;
    const bytes = result.size || pick.size;
    if (seconds >= 1 && bytes >= 512 * 1024) usePrefs.getState().recordDownloadSpeed(bytes / seconds);
    const entry: InstallerFile = {
      appId: app.id,
      name: app.name,
      iconUrl: app.icon_url,
      packageName: app.package_name,
      version: app.latest_version,
      publishedAt: app.latest_published_at,
      assetName: pick.name,
      uri: result.path,
      size: bytes,
      downloadedAt: new Date().toISOString(),
    };
    const replaced = useInstallers.getState().put(entry);
    if (replaced) bridge.remove(replaced.uri).catch(() => undefined);
    await count(app.id, 'download', app.latest_version);
    return entry;
  } catch (e) {
    useTasks.getState().set(app.id, { status: 'error', progress: 0, error: (e as Error).message });
    throw e;
  } finally {
    stop();
    if (useTasks.getState().tasks[app.id]?.status === 'downloading') useTasks.getState().set(app.id, null);
  }
}

async function desktopInstall(file: InstallerFile, kind: 'install' | 'update'): Promise<InstallOutcome> {
  const bridge = desktop!;
  if (!(await bridge.exists(file.uri))) {
    useInstallers.getState().remove(file.appId);
    throw new Error('The downloaded file is gone. Click Get to download it again.');
  }
  useTasks.getState().set(file.appId, { status: 'installing', progress: 1 });
  try {
    const result = await bridge.install(file.uri, { name: file.name, iconUrl: file.iconUrl });
    if (result.outcome === 'cancelled') return 'cancelled';

    const previous = useInstalled.getState().apps[file.appId];
    useInstalled.getState().markInstalled({
      appId: file.appId,
      name: file.name,
      iconUrl: file.iconUrl,
      packageName: file.packageName,
      version: file.version,
      publishedAt: file.publishedAt,
      assetName: file.assetName,
      installedAt: new Date().toISOString(),
      launchPath: result.launchPath ?? previous?.launchPath ?? null,
    });
    // Another installer took over (MSIX, PKG, a software center): remember the version so
    // updates are tracked, but only count installs ArkStore saw finish.
    if (result.outcome === 'handed-off') return 'handed-off';

    await count(file.appId, kind, file.version);
    if (usePrefs.getState().installerCleanup !== 'keep') deleteInstaller(file.appId);
    return 'installed';
  } finally {
    useTasks.getState().set(file.appId, null);
  }
}

/** Forget desktop apps whose files were removed outside ArkStore (a deleted .app or AppImage). */
export async function reconcileDesktopApps() {
  if (!desktop) return;
  const { apps, forget } = useInstalled.getState();
  for (const app of Object.values(apps)) {
    if (app.launchPath && !(await desktop.exists(app.launchPath))) forget(app.appId);
  }
}
