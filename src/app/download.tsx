// Get ArkStore: one page for every device, laid out like the big download pages people know
// (VS Code's): a column per platform with one big button for the usual download and a small
// grid of every other format and CPU type. It recognizes the device it's opened on and
// highlights that platform. Reads ArkStore's newest GitHub release, so it never needs editing
// for a new version.
import { AndroidLogo } from 'phosphor-react-native/src/icons/AndroidLogo';
import { AppleLogo } from 'phosphor-react-native/src/icons/AppleLogo';
import { ArrowSquareOut } from 'phosphor-react-native/src/icons/ArrowSquareOut';
import { DownloadSimple } from 'phosphor-react-native/src/icons/DownloadSimple';
import { LinuxLogo } from 'phosphor-react-native/src/icons/LinuxLogo';
import { WindowsLogo } from 'phosphor-react-native/src/icons/WindowsLogo';
import type { Icon } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { DotGrid } from '@/components/ui/dots';
import { EmptyState, Skeleton } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { desktop } from '@/lib/desktop';
import { fileSize, relativeDate } from '@/lib/format';
import { chooseApkForDevice } from '@/lib/github/apk';
import { assetKind, bestAsset, type Arch, type AssetKind, type ReleaseFile, type StoreOS } from '@/lib/github/assets';
import { currentDevice, type Visitor } from '@/lib/platform';
import { ARKSTORE_REPO, currentArkStoreVersion, isNewerVersion, useLatestArkStore, type ArkStoreRelease } from '@/lib/self-update';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

type Column = { os: StoreOS; name: string; icon: Icon; needs: string; how: string };

const COLUMNS: Column[] = [
  {
    os: 'windows',
    name: 'Windows',
    icon: WindowsLogo,
    needs: 'Windows 10, 11',
    how: 'If SmartScreen appears, choose More info, then Run anyway.',
  },
  {
    os: 'macos',
    name: 'Mac',
    icon: AppleLogo,
    needs: 'macOS 12 or later',
    how: 'Drag ArkStore into Applications. The first time, right-click it and choose Open.',
  },
  {
    os: 'linux',
    name: 'Linux',
    icon: LinuxLogo,
    needs: 'AppImage · .deb',
    how: 'AppImage: make it executable and run it. .deb: open it with your software center or apt.',
  },
  {
    os: 'android',
    name: 'Android',
    icon: AndroidLogo,
    needs: 'Android 7 or later',
    how: 'Open the APK and allow installs from your browser when Android asks.',
  },
];

// Format rows in the small grid, in this order.
const KIND_ROW: Partial<Record<AssetKind, string>> = {
  exe: 'Installer',
  msi: '.msi',
  msix: '.msix',
  dmg: '.dmg',
  pkg: '.pkg',
  zip: '.zip',
  appimage: 'AppImage',
  deb: '.deb',
  rpm: '.rpm',
  flatpak: 'Flatpak',
  tar: '.tar.gz',
  apk: '.apk',
};
const KIND_ORDER = Object.keys(KIND_ROW) as AssetKind[];
const ARCH_ORDER: (Arch | null)[] = [null, 'x64', 'arm64', 'universal', 'armv7', 'x86'];

const ARCH_CHIP: Record<Arch, string> = { x64: 'x64', arm64: 'Arm64', armv7: 'Arm32', x86: 'x86', universal: 'Universal' };

function archChip(os: StoreOS, arch: Arch | null) {
  if (os === 'macos' && arch === 'arm64') return 'Apple silicon';
  if (os === 'macos' && arch === 'x64') return 'Intel chip';
  return arch ? ARCH_CHIP[arch] : 'Download';
}

const ANDROID_ABI: Record<string, string> = { arm64: 'arm64-v8a', armv7: 'armeabi-v7a', x64: 'x86_64', x86: 'x86' };

/** The big button's file: the one that fits this device, or the usual pick for other platforms. */
function mainFile(release: ArkStoreRelease, os: StoreOS, device: Visitor): ReleaseFile | null {
  const mine = device.os === os;
  if (os === 'android') {
    const apks = release.files.filter((f) => f.os === 'android');
    const abi = mine && device.arch ? ANDROID_ABI[device.arch] : 'arm64-v8a';
    return (chooseApkForDevice(apks, abi ? [abi] : []) as ReleaseFile | null) ?? null;
  }
  // Other people's computers: the most common machine (x64; Apple silicon for Macs).
  const arch = mine ? device.arch : os === 'macos' ? 'arm64' : 'x64';
  return bestAsset(release.files, { os, arch });
}

function open(file: ReleaseFile) {
  if (desktop) desktop.openExternal(file.url).catch(() => undefined);
  else Linking.openURL(file.url).catch(() => undefined);
}

function machineName(device: Visitor) {
  if (device.os === 'macos') return device.arch === 'arm64' ? 'Mac with Apple silicon' : device.arch === 'x64' ? 'Mac with an Intel chip' : 'Mac';
  if (device.os === 'windows') return device.arch === 'arm64' ? 'Windows PC (Arm)' : 'Windows PC';
  if (device.os === 'linux') return device.arch === 'arm64' ? 'Linux computer (Arm)' : 'Linux computer';
  return device.label;
}

function Chip({ label, file, highlight }: { label: string; file: ReleaseFile; highlight: boolean }) {
  const c = useColors();
  return (
    <Tap
      scale={0.95}
      onPress={() => open(file)}
      accessibilityRole="link"
      accessibilityLabel={`Download ${file.name}, ${fileSize(file.size)}`}
      style={{
        height: 28,
        paddingHorizontal: 11,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: highlight ? c.accent : c.line,
        backgroundColor: c.surface2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Txt variant="mono" style={{ fontSize: 11 }} color={highlight ? 'accent' : 'text'}>
        {label}
      </Txt>
    </Tap>
  );
}

function PlatformColumn({ col, release, device }: { col: Column; release: ArkStoreRelease; device: Visitor }) {
  const c = useColors();
  const mine = device.os === col.os;
  const main = mainFile(release, col.os, device);
  const files = release.files.filter((f) => f.os === col.os);
  const rows = KIND_ORDER.map((kind) => ({
    kind,
    files: files
      .filter((f) => assetKind(f.name) === kind)
      .sort((a, b) => ARCH_ORDER.indexOf(a.arch) - ARCH_ORDER.indexOf(b.arch)),
  })).filter((r) => r.files.length > 0);
  const Glyph = col.icon;

  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 250,
        minWidth: 250,
        borderRadius: radius.card,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: mine ? c.accent : 'transparent',
        padding: 20,
        alignItems: 'center',
        gap: 14,
      }}
    >
      <View style={{ height: 16, justifyContent: 'center' }}>
        {mine ? (
          <Txt variant="label" color="accent" style={{ fontSize: 9.5 }}>
            Your device
          </Txt>
        ) : null}
      </View>
      <Glyph size={64} color={mine ? c.accent : c.text} weight="light" />

      {main ? (
        <Tap
          onPress={() => open(main)}
          accessibilityRole="link"
          accessibilityLabel={`Download ArkStore for ${col.name}`}
          style={{
            alignSelf: 'stretch',
            borderRadius: radius.tile,
            backgroundColor: mine ? c.accent : c.invert,
            paddingVertical: 12,
            paddingHorizontal: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <DownloadSimple size={22} color={mine ? c.onAccent : c.onInvert} weight="bold" />
          <View style={{ flex: 1 }}>
            <Txt variant="headline" color={mine ? 'onAccent' : 'onInvert'}>
              {col.name}
            </Txt>
            <Txt variant="caption" color={mine ? 'onAccent' : 'onInvert'} style={{ opacity: 0.8 }}>
              {col.needs}
            </Txt>
          </View>
          <Txt variant="mono" color={mine ? 'onAccent' : 'onInvert'} style={{ fontSize: 11, opacity: 0.8 }}>
            {fileSize(main.size)}
          </Txt>
        </Tap>
      ) : (
        <View style={{ alignSelf: 'stretch', borderRadius: radius.tile, backgroundColor: c.surface2, paddingVertical: 16, alignItems: 'center' }}>
          <Txt variant="callout" color="text3">
            Not in this release
          </Txt>
        </View>
      )}

      <View style={{ alignSelf: 'stretch', gap: 8 }}>
        {rows.map((row) => (
          <View key={row.kind} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt variant="mono" color="text2" style={{ width: 72, fontSize: 11 }}>
              {KIND_ROW[row.kind]}
            </Txt>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {row.files.map((f) => (
                <Chip key={f.name} label={archChip(col.os, f.arch)} file={f} highlight={mine && main?.name === f.name} />
              ))}
            </View>
          </View>
        ))}
      </View>

      {main ? (
        <Txt variant="caption" color="text3" style={{ alignSelf: 'stretch' }}>
          {col.how}
        </Txt>
      ) : null}
    </View>
  );
}

/** A line for people already running ArkStore: up to date, or an update is out. */
function InAppNote({ release, device }: { release: ArkStoreRelease; device: Visitor }) {
  const running = currentArkStoreVersion();
  const inApp = Boolean(desktop) || Platform.OS === 'android';
  if (!inApp || !running) return null;
  const upToDate = !isNewerVersion(release.version, running);
  return (
    <Txt variant="callout" color="text2" align="center">
      {upToDate
        ? `This ${machineName(device)} has the newest ArkStore (${running}). Get it on your other devices below.`
        : `This ${machineName(device)} has ArkStore ${running}. It updates itself, or download ${release.version} below.`}
    </Txt>
  );
}

export default function DownloadScreen() {
  const c = useColors();
  const latest = useLatestArkStore();
  const [device, setDevice] = useState<Visitor | null>(null);

  useEffect(() => {
    currentDevice().then(setDevice).catch(() => setDevice({ os: null, arch: null, label: 'this device' }));
  }, []);

  const release = latest.data;
  // On the website there's nowhere to go back to; in the apps this is a screen like any other.
  const standalone = Platform.OS === 'web' && !desktop;
  // Your platform first on narrow screens, where the columns stack.
  const columns = device?.os ? [...COLUMNS].sort((a, b) => Number(b.os === device.os) - Number(a.os === device.os)) : COLUMNS;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {standalone ? null : <TopBar close title="Get ArkStore" />}
      <ScrollView contentContainerStyle={{ paddingBottom: 60, paddingTop: standalone ? 40 : 8 }}>
        <View style={{ width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: space.gutter, gap: 28 }}>
          <View style={{ borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
            <DotGrid gap={12} size={1.1} />
            <View style={{ paddingVertical: 36, paddingHorizontal: 20, alignItems: 'center', gap: 10 }}>
              <Txt variant="hero" align="center" accessibilityRole="header">
                Download ArkStore
              </Txt>
              <Txt variant="body" color="text2" align="center" style={{ maxWidth: 560 }}>
                Apps that live on GitHub, installed and kept up to date. Free and open source, on Windows, macOS, Linux and
                Android.
              </Txt>
              {release ? (
                <Txt variant="label" color="text3">
                  {`Version ${release.version}  ·  ${relativeDate(release.publishedAt).toLowerCase()}`}
                </Txt>
              ) : null}
              {device?.os === 'ios' ? (
                <Txt variant="callout" color="text2" align="center" style={{ marginTop: 6 }}>
                  Not on iPhone or iPad yet: iOS only installs apps from the App Store.
                </Txt>
              ) : null}
            </View>
          </View>

          {latest.isLoading || !device ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
              {COLUMNS.map((col) => (
                <Skeleton key={col.os} style={{ flexGrow: 1, flexBasis: 250, height: 320, borderRadius: radius.card }} />
              ))}
            </View>
          ) : latest.error || !release ? (
            <EmptyState
              glyph="?"
              title="Couldn't load the downloads"
              body={latest.error ? friendlyError(latest.error) : `${ARKSTORE_REPO} has no releases yet.`}
              action={<Button label="Try again" variant="secondary" onPress={() => latest.refetch()} />}
            />
          ) : (
            <>
              <InAppNote release={release} device={device} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                {columns.map((col) => (
                  <PlatformColumn key={col.os} col={col} release={release} device={device} />
                ))}
              </View>
              <View style={{ alignItems: 'center', gap: 12 }}>
                <Txt variant="callout" color="text2" align="center" style={{ maxWidth: 640 }}>
                  ArkStore keeps itself up to date. Sign in with GitHub on each device and they all show up under Account,
                  where you can sign any of them out.
                </Txt>
                <Tap
                  onPress={() => Linking.openURL(release.url)}
                  accessibilityRole="link"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <Txt variant="label">Release notes and checksums on GitHub</Txt>
                  <ArrowSquareOut size={14} color={c.text} />
                </Tap>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
