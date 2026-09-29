// iPhone: ArkStore is installed through SideStore, signed with the person's own Apple Account,
// and stops opening when that signature runs out (7 days on a free account). SideStore refreshes
// every app at once, so ArkStore's own expiry is theirs too. ArkStore reads it from its
// provisioning profile and reminds 3 days and 1 day before; tapping a reminder opens SideStore
// (when ArkStore was installed from a computer instead, the reminder says to connect to it).
import * as Notifications from 'expo-notifications';
import { File, Paths } from 'expo-file-system';
import { Linking, Platform } from 'react-native';

import { provisionExpiry, reminderTimes, REMINDERS } from './provision';

const BODY_SIDESTORE = 'Tap to open SideStore, connect LocalDevVPN and refresh them.';
// Installed by ArkStore on a computer (no SideStore on the phone): that computer renews them.
const BODY_COMPUTER = 'Connect your iPhone to the computer with ArkStore open (cable, or the same Wi-Fi) and it renews them.';

/** The notification's action: open SideStore. */
export const SIDESTORE_OPEN = 'sidestore://';

/** When ArkStore's own signature runs out, or null (App Store, TestFlight, developer builds). */
export function readExpiry(): Date | null {
  try {
    const file = new File(Paths.bundle, 'embedded.mobileprovision');
    // The profile is binary (a signed envelope) around an XML plist: decode it byte by byte
    // (base64, then atob) rather than as UTF-8, which the binary parts would fail.
    return file.exists ? provisionExpiry(atob(file.base64Sync())) : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the reminders matching the current signature. Runs at launch and whenever ArkStore comes
 * back to the foreground, so a refresh in SideStore moves them to the new date.
 */
export async function scheduleExpiryReminders() {
  if (Platform.OS !== 'ios') return;
  const expiry = readExpiry();
  if (!expiry) return; // App Store, TestFlight or a developer build: nothing expires weekly.
  for (const r of REMINDERS) await Notifications.cancelScheduledNotificationAsync(r.id).catch(() => undefined);
  // The reminder is the point, so ask once (iOS shows the prompt only the first time).
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return;
  const sideStore = await Linking.canOpenURL(SIDESTORE_OPEN).catch(() => false);
  for (const r of reminderTimes(expiry)) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: sideStore ? BODY_SIDESTORE : BODY_COMPUTER, data: sideStore ? { open: SIDESTORE_OPEN } : {} },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
    });
  }
}

/** Handles a tapped notification that points outside ArkStore (SideStore). */
export function openExternal(url: unknown) {
  if (typeof url === 'string') Linking.openURL(url).catch(() => undefined);
}
