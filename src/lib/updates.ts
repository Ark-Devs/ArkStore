// "This app has a new update", Play Store style. The catalog is kept fresh by the
// release-sync job in Postgres; phones compare it with what they installed, in the
// foreground and every few hours in the background, and notify once per release.
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { fetchAppsByIds } from './api';
import { hasUpdate, useInstalled, type PendingUpdate } from './stores/installed';
import { usePrefs } from './stores/prefs';

export const UPDATE_TASK = 'arkstore.update-check';
const CHANNEL = 'updates';

async function ensureHydrated() {
  if (!useInstalled.persist.hasHydrated()) await useInstalled.persist.rehydrate();
  if (!usePrefs.persist.hasHydrated()) await usePrefs.persist.rehydrate();
}

export async function checkForUpdates({ notify }: { notify: boolean }): Promise<PendingUpdate[]> {
  await ensureHydrated();
  const { apps, setUpdates } = useInstalled.getState();
  const ids = Object.keys(apps);
  const now = new Date().toISOString();
  if (ids.length === 0) {
    setUpdates([], now);
    return [];
  }

  const catalog = await fetchAppsByIds(ids);
  const pending = catalog
    .filter((a) => apps[a.id] && hasUpdate(apps[a.id], a))
    .map((a) => ({ appId: a.id, fromVersion: apps[a.id].version, app: a }));
  setUpdates(pending, now);

  if (notify && usePrefs.getState().notifyUpdates) await notifyNew(pending);
  return pending;
}

async function notifyNew(pending: PendingUpdate[]) {
  if (Platform.OS === 'web') return;
  const { notified, markNotified } = useInstalled.getState();
  const fresh = pending.filter((u) => notified[u.appId] !== u.app.latest_version);
  if (fresh.length === 0) return;
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return;

  const first = fresh[0].app;
  const content =
    fresh.length === 1
      ? {
          title: `${first.name} has an update`,
          body: `Version ${first.latest_version} is ready. Tap to update.`,
          data: { url: `/app/${first.id}` },
        }
      : {
          title: `${fresh.length} app updates`,
          body: `${fresh.map((u) => u.app.name).slice(0, 4).join(', ')}${fresh.length > 4 ? ' and more' : ''} can be updated.`,
          data: { url: '/updates' },
        };

  await Notifications.scheduleNotificationAsync({
    content,
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
  markNotified(Object.fromEntries(fresh.map((u) => [u.appId, u.app.latest_version ?? ''])));
}

// Must be defined at module scope so Android can run it without the UI.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(UPDATE_TASK, async () => {
    try {
      await checkForUpdates({ notify: true });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function setupUpdateChecks() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'App updates',
      description: 'When an app you installed from ArkStore has a new version',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#D71921',
    });
  }
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Available) {
      const registered = await TaskManager.isTaskRegisteredAsync(UPDATE_TASK);
      // Android runs it roughly every 3 hours, batched with other work to save battery.
      if (!registered) await BackgroundTask.registerTaskAsync(UPDATE_TASK, { minimumInterval: 180 });
    }
  } catch {
    // Background work isn't available in every runtime (e.g. Expo Go); foreground checks still run.
  }
}

export async function notificationsAllowed() {
  if (Platform.OS === 'web') return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

export async function askForNotifications() {
  if (Platform.OS === 'web') return false;
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}
