// Every phone and computer signed in to the account, for the list in Account. Each device
// checks in (public.register_device) when it signs in and whenever it comes to the
// foreground; a device signed out from elsewhere learns it at its next check-in.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { AppState, Platform } from 'react-native';

import { desktop } from './desktop';
import { detectVisitor } from './platform';
import { usePrefs } from './stores/prefs';
import { supabase } from './supabase';

export type DevicePlatform = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'web';

export type SignedInDevice = {
  id: string;
  device_id: string;
  platform: DevicePlatform;
  name: string;
  os_version: string | null;
  arch: string | null;
  app_version: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

const APP_VERSION = Application.nativeApplicationVersion ?? '';

function browserName(ua: string) {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/firefox\//i.test(ua)) return 'Firefox';
  if (/chrome\//i.test(ua)) return 'Chrome';
  if (/safari\//i.test(ua)) return 'Safari';
  return 'Browser';
}

/** What this device reports about itself. */
export function describeThisDevice() {
  if (desktop) {
    return {
      platform: desktop.os as DevicePlatform,
      name: desktop.hostname,
      osVersion: desktop.osVersion,
      arch: desktop.arch,
      appVersion: desktop.appVersion,
    };
  }
  if (Platform.OS === 'web') {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const v = detectVisitor(ua);
    return {
      platform: 'web' as DevicePlatform,
      name: `${browserName(ua)} on ${v.os ? v.label : 'the web'}`,
      osVersion: null,
      arch: v.arch,
      appVersion: APP_VERSION || null,
    };
  }
  return {
    platform: Platform.OS as DevicePlatform,
    name: Device.deviceName || [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || 'Phone',
    osVersion: Device.osVersion,
    arch: Device.supportedCpuArchitectures?.[0] ?? null,
    appVersion: APP_VERSION || null,
  };
}

async function deviceId() {
  if (!usePrefs.persist.hasHydrated()) await usePrefs.persist.rehydrate();
  return usePrefs.getState().deviceId;
}

let lastCheckIn = 0;

/** Tells the account this device is here. Signs out locally when another device signed it out. */
export async function checkIn(force = false) {
  if (!force && Date.now() - lastCheckIn < 5 * 60 * 1000) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  lastCheckIn = Date.now();
  const me = describeThisDevice();
  const { data: status, error } = await supabase.rpc('register_device', {
    p_device_id: await deviceId(),
    p_platform: me.platform,
    p_name: me.name,
    p_os_version: me.osVersion,
    p_arch: me.arch,
    p_app_version: me.appVersion,
  });
  if (error) return; // Offline, or the database hasn't been updated yet: try again later.
  if (status === 'signed_out') await supabase.auth.signOut({ scope: 'local' });
}

/** Call before signing out on this device, so it leaves the list. */
export async function forgetThisDevice() {
  await supabase.rpc('forget_device', { p_device_id: await deviceId() });
}

export async function signOutDevice(id: string) {
  const { error } = await supabase.rpc('sign_out_device', { p_id: id });
  if (error) throw error;
}

export function useMyDevices(uid: string | undefined) {
  return useQuery({
    queryKey: ['devices', uid ?? ''],
    enabled: Boolean(uid),
    queryFn: async () => {
      await checkIn(true);
      const { data, error } = await supabase
        .from('user_devices')
        .select('id,device_id,platform,name,os_version,arch,app_version,first_seen_at,last_seen_at')
        .is('signed_out_at', null)
        .order('last_seen_at', { ascending: false });
      if (error) throw error;
      return data as SignedInDevice[];
    },
  });
}

export function useThisDeviceId() {
  return usePrefs((s) => s.deviceId);
}

export function useInvalidateDevices() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['devices'] });
}

supabase.auth.onAuthStateChange((event, session) => {
  if (!session) return;
  if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
    // Outside the auth callback: supabase-js holds a lock while it runs.
    setTimeout(() => checkIn(event === 'SIGNED_IN').catch(() => undefined), 0);
  }
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') checkIn().catch(() => undefined);
});
