import { AndroidLogo } from 'phosphor-react-native/src/icons/AndroidLogo';
import { AppleLogo } from 'phosphor-react-native/src/icons/AppleLogo';
import { Globe } from 'phosphor-react-native/src/icons/Globe';
import { LinuxLogo } from 'phosphor-react-native/src/icons/LinuxLogo';
import { WindowsLogo } from 'phosphor-react-native/src/icons/WindowsLogo';
import type { Icon } from 'phosphor-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { DotRule } from '@/components/ui/dots';
import { RowSkeleton } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { confirmAction, showAlert } from '@/lib/alert';
import {
  signOutDevice,
  useInvalidateDevices,
  useMyDevices,
  useThisDeviceId,
  type DevicePlatform,
  type SignedInDevice,
} from '@/lib/devices';
import { relativeDate } from '@/lib/format';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

const PLATFORM: Record<DevicePlatform, { label: string; icon: Icon }> = {
  android: { label: 'Android', icon: AndroidLogo },
  ios: { label: 'iOS', icon: AppleLogo },
  windows: { label: 'Windows', icon: WindowsLogo },
  macos: { label: 'macOS', icon: AppleLogo },
  linux: { label: 'Linux', icon: LinuxLogo },
  web: { label: 'Web', icon: Globe },
};

function DeviceRow({ device, current, onSignedOut }: { device: SignedInDevice; current: boolean; onSignedOut: () => void }) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const p = PLATFORM[device.platform] ?? PLATFORM.web;
  const details = [
    [p.label, device.os_version].filter(Boolean).join(' '),
    device.arch,
    device.app_version ? `ArkStore ${device.app_version}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const signOut = async () => {
    const ok = await confirmAction(
      `Sign out ${device.name || p.label}?`,
      "It will need to sign in with GitHub again to publish or to show up here. Apps installed on it stay installed.",
      'Sign out',
      true,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await signOutDevice(device.id);
      onSignedOut();
    } catch (e) {
      showAlert("Couldn't sign it out", friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }}>
      <View style={{ width: 44, height: 44, borderRadius: radius.tile, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
        <p.icon size={22} color={current ? c.accent : c.text} weight="light" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {device.name || p.label}
          </Txt>
          {current ? (
            <Txt variant="label" color="accent" style={{ fontSize: 9.5 }}>
              This device
            </Txt>
          ) : null}
        </View>
        <Txt variant="mono" color="text3" numberOfLines={1} style={{ fontSize: 11 }}>
          {details}
        </Txt>
        <Txt variant="caption" color="text3">
          {current ? 'Active now' : `Last active ${relativeDate(device.last_seen_at).toLowerCase()}`}
        </Txt>
      </View>
      {!current ? (
        <Tap
          onPress={signOut}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Sign out ${device.name || p.label}`}
          style={{ height: 30, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}
        >
          <Txt variant="label" style={{ fontSize: 11 }}>
            Sign out
          </Txt>
        </Tap>
      ) : null}
    </View>
  );
}

/** Every phone and computer signed in to this account, on any platform. */
export function DeviceList({ uid }: { uid: string }) {
  const { data, isLoading, error } = useMyDevices(uid);
  const thisDevice = useThisDeviceId();
  const refresh = useInvalidateDevices();

  if (isLoading) return <RowSkeleton count={2} />;
  if (error) {
    return (
      <Txt variant="callout" color="text2" style={{ paddingHorizontal: space.gutter }}>
        {friendlyError(error)}
      </Txt>
    );
  }
  const devices = [...(data ?? [])].sort((a, b) => Number(b.device_id === thisDevice) - Number(a.device_id === thisDevice));
  const platforms = [...new Set(devices.map((d) => (PLATFORM[d.platform] ?? PLATFORM.web).label))];

  return (
    <View style={{ paddingHorizontal: space.gutter }}>
      <Txt variant="callout" color="text2" style={{ marginBottom: 4 }}>
        {devices.length === 1
          ? 'Signed in on this device only.'
          : `Signed in on ${devices.length} devices: ${platforms.join(', ')}.`}
      </Txt>
      {devices.map((d, i) => (
        <View key={d.id}>
          {i > 0 ? <DotRule /> : null}
          <DeviceRow device={d} current={d.device_id === thisDevice} onSignedOut={refresh} />
        </View>
      ))}
    </View>
  );
}
