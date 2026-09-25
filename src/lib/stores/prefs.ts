import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePref = 'system' | 'dark' | 'light';

/** What to do with an APK once the app it installed is confirmed. */
export type InstallerCleanup = 'ask' | 'delete' | 'keep';

type Prefs = {
  theme: ThemePref;
  /** Random id for de-duplicating download counts. Not tied to the person. */
  deviceId: string;
  /** Build picked by hand on the app page, per app id (asset name). */
  buildOverride: Record<string, string>;
  notifyUpdates: boolean;
  installerCleanup: InstallerCleanup;
  /** Measured APK download speed on this phone (bytes/second), smoothed across downloads. */
  downloadSpeed: number | null;
  /** ArkStore version whose update banner the person dismissed ("Later"). */
  hiddenSelfUpdate: string | null;
  hideSelfUpdate: (version: string) => void;
  setTheme: (t: ThemePref) => void;
  recordDownloadSpeed: (bytesPerSecond: number) => void;
  setBuildOverride: (appId: string, assetName: string | null) => void;
  setNotifyUpdates: (on: boolean) => void;
  setInstallerCleanup: (v: InstallerCleanup) => void;
};

const newDeviceId = () =>
  Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      theme: 'system',
      deviceId: newDeviceId(),
      buildOverride: {},
      notifyUpdates: true,
      installerCleanup: 'ask',
      downloadSpeed: null,
      hiddenSelfUpdate: null,
      hideSelfUpdate: (hiddenSelfUpdate) => set({ hiddenSelfUpdate }),
      setTheme: (theme) => set({ theme }),
      // Weighted toward recent downloads, so a switch from Wi-Fi to mobile data shows up quickly.
      recordDownloadSpeed: (bps) =>
        set((s) => ({ downloadSpeed: s.downloadSpeed ? s.downloadSpeed * 0.5 + bps * 0.5 : bps })),
      setBuildOverride: (appId, assetName) =>
        set((s) => {
          const next = { ...s.buildOverride };
          if (assetName) next[appId] = assetName;
          else delete next[appId];
          return { buildOverride: next };
        }),
      setNotifyUpdates: (notifyUpdates) => set({ notifyUpdates }),
      setInstallerCleanup: (installerCleanup) => set({ installerCleanup }),
    }),
    { name: 'arkstore.prefs', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
