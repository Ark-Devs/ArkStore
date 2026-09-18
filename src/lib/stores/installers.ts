import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { InstalledApp } from './installed';

/** An APK ArkStore downloaded and still has on disk. One per app: the newest one. */
export type InstallerFile = {
  appId: string;
  name: string;
  iconUrl: string | null;
  packageName: string | null;
  version: string;
  publishedAt: string | null;
  assetName: string;
  uri: string;
  size: number;
  downloadedAt: string;
};

/**
 * ready      downloaded, not installed yet: tap Install, no second download
 * installed  this exact version is installed: the file is no longer needed
 * outdated   a newer version is already installed: the file is no longer needed
 */
export type InstallerStatus = 'ready' | 'installed' | 'outdated';

export function installerStatus(file: InstallerFile, installed: InstalledApp | undefined): InstallerStatus {
  if (!installed) return 'ready';
  if (installed.version === file.version) return 'installed';
  if (installed.publishedAt && file.publishedAt && Date.parse(installed.publishedAt) > Date.parse(file.publishedAt)) {
    return 'outdated';
  }
  return 'ready';
}

export const isNeeded = (status: InstallerStatus) => status === 'ready';

type InstallersState = {
  files: Record<string, InstallerFile>;
  /** Returns the file it replaced, so the caller can delete it from disk. */
  put: (file: InstallerFile) => InstallerFile | undefined;
  remove: (appId: string) => void;
};

export const useInstallers = create<InstallersState>()(
  persist(
    (set, get) => ({
      files: {},
      put: (file) => {
        const previous = get().files[file.appId];
        set((s) => ({ files: { ...s.files, [file.appId]: file } }));
        return previous && previous.uri !== file.uri ? previous : undefined;
      },
      remove: (appId) =>
        set((s) => {
          const files = { ...s.files };
          delete files[appId];
          return { files };
        }),
    }),
    { name: 'arkstore.installers', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
