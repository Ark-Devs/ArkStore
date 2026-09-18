import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ListApp } from '../types';

/** An app installed through ArkStore, remembered on this phone. */
export type InstalledApp = {
  appId: string;
  name: string;
  iconUrl: string | null;
  packageName: string | null;
  version: string;
  publishedAt: string | null;
  assetName: string;
  installedAt: string;
};

export type PendingUpdate = {
  appId: string;
  fromVersion: string;
  app: ListApp;
};

type InstalledState = {
  apps: Record<string, InstalledApp>;
  /** Updates found by the last check, keyed by app id. */
  updates: Record<string, PendingUpdate>;
  /** Last version we sent a notification for, so each release notifies once. */
  notified: Record<string, string>;
  lastCheckedAt: string | null;
  markInstalled: (entry: InstalledApp) => void;
  forget: (appId: string) => void;
  setUpdates: (updates: PendingUpdate[], checkedAt: string) => void;
  markNotified: (entries: Record<string, string>) => void;
};

export const useInstalled = create<InstalledState>()(
  persist(
    (set) => ({
      apps: {},
      updates: {},
      notified: {},
      lastCheckedAt: null,
      markInstalled: (entry) =>
        set((s) => {
          const updates = { ...s.updates };
          delete updates[entry.appId];
          return { apps: { ...s.apps, [entry.appId]: entry }, updates };
        }),
      forget: (appId) =>
        set((s) => {
          const apps = { ...s.apps };
          const updates = { ...s.updates };
          delete apps[appId];
          delete updates[appId];
          return { apps, updates };
        }),
      setUpdates: (list, checkedAt) =>
        set({ updates: Object.fromEntries(list.map((u) => [u.appId, u])), lastCheckedAt: checkedAt }),
      markNotified: (entries) => set((s) => ({ notified: { ...s.notified, ...entries } })),
    }),
    { name: 'arkstore.installed', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/** A newer release is out when the tag differs and it isn't older than what's installed. */
export function hasUpdate(installed: InstalledApp, app: Pick<ListApp, 'latest_version' | 'latest_published_at'>) {
  if (!app.latest_version || app.latest_version === installed.version) return false;
  if (!installed.publishedAt || !app.latest_published_at) return true;
  return Date.parse(app.latest_published_at) >= Date.parse(installed.publishedAt);
}
