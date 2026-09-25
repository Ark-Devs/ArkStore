// Get ArkStore: one page for every device. It recognizes the device it's opened on, puts the
// download that works best for it first, and lists the builds for every other platform.
// Reads ArkStore's newest GitHub release, so it never needs editing for a new version.
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
import { DotGrid, DotRule } from '@/components/ui/dots';
import { EmptyState, SectionHeader, Skeleton } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { desktop } from '@/lib/desktop';
import { fileSize, relativeDate } from '@/lib/format';
import { chooseApkForDevice } from '@/lib/github/apk';
import { ALL_OS, archLabel, bestAsset, fileLabel, OS_LABEL, rankAssets, type ReleaseFile, type StoreOS } from '@/lib/github/assets';
import { currentDevice, type Visitor } from '@/lib/platform';
import { ARKSTORE_REPO, currentArkStoreVersion, isNewerVersion, useLatestArkStore, type ArkStoreRelease } from '@/lib/self-update';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

const ICON: Record<StoreOS, Icon> = {
  android: AndroidLogo,
  windows: WindowsLogo,
  macos: AppleLogo,
  linux: LinuxLogo,
};

const HOW: Record<StoreOS, string> = {
  android: 'Open the APK and allow installs from your browser when Android asks.',
  windows: 'Run the installer. If SmartScreen appears, choose More info, then Run anyway.',
  macos: 'Open the disk image and drag ArkStore into Applications. If macOS asks, right-click ArkStore and choose Open.',
  linux: 'Make the AppImage executable (chmod +x) and run it, or install the .deb / .rpm with your package manager.',
};

const ANDROID_ABI: Record<string, string> = { arm64: 'arm64-v8a', armv7: 'armeabi-v7a', x64: 'x86_64', x86: 'x86' };

/** The file that works best on a device. */
function recommend(release: ArkStoreRelease, device: Visitor): ReleaseFile | null {
  if (!device.os || device.os === 'ios') return null;
  if (device.os === 'android') {
    const apks = release.files.filter((f) => f.os === 'android');
    const abi = device.arch ? ANDROID_ABI[device.arch] : null;
    return (chooseApkForDevice(apks, abi ? [abi] : []) as ReleaseFile | null) ?? null;
  }
  return bestAsset(release.files, { os: device.os, arch: device.arch });
}

function machineName(device: Visitor) {
  if (device.os === 'macos') return device.arch === 'arm64' ? 'Mac with Apple silicon' : device.arch === 'x64' ? 'Mac with an Intel chip' : 'Mac';
  const arch = device.os === 'android' ? null : archLabel(device.arch);
  return [device.label, arch ? `(${arch})` : null].filter(Boolean).join(' ');
}

function download(file: ReleaseFile) {
  if (desktop) desktop.openExternal(file.url).catch(() => undefined);
  else Linking.openURL(file.url).catch(() => undefined);
}

function FileRow({ file, best }: { file: ReleaseFile; best: boolean }) {
  const c = useColors();
  return (
    <Tap
      scale={0.99}
      onPress={() => download(file)}
      accessibilityRole="link"
      accessibilityLabel={`Download ${file.name}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="subhead">{fileLabel(file)}</Txt>
          {best ? (
            <Txt variant="label" color="accent" style={{ fontSize: 9 }}>
              Recommended
            </Txt>
          ) : null}
        </View>
        <Txt variant="mono" color="text3" numberOfLines={1} style={{ fontSize: 11 }}>
          {file.name}  ·  {fileSize(file.size)}
        </Txt>
      </View>
      <DownloadSimple size={20} color={best ? c.accent : c.text2} />
    </Tap>
  );
}

function PlatformBlock({ os, release, device }: { os: StoreOS; release: ArkStoreRelease; device: Visitor }) {
  const c = useColors();
  const files =
    os === 'android'
      ? release.files.filter((f) => f.os === 'android')
      : rankAssets(release.files, { os, arch: device.os === os ? device.arch : null });
  const best = device.os === os ? recommend(release, device) : files[0];
  const Glyph = ICON[os];
  return (
    <View style={{ marginHorizontal: space.gutter, marginBottom: 14, borderRadius: radius.card, backgroundColor: c.surface, padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Glyph size={24} color={c.text} weight="light" />
        <Txt variant="section" style={{ flex: 1 }}>
          {OS_LABEL[os]}
        </Txt>
        {device.os === os ? (
          <Txt variant="label" color="accent" style={{ fontSize: 9.5 }}>
            This device
          </Txt>
        ) : null}
      </View>
      {files.length === 0 ? (
        <Txt variant="callout" color="text3" style={{ paddingVertical: 8 }}>
          Not in this release.
        </Txt>
      ) : (
        <>
          {files.map((f, i) => (
            <View key={f.name}>
              {i > 0 ? <DotRule /> : null}
              <FileRow file={f} best={best?.name === f.name} />
            </View>
          ))}
          <Txt variant="caption" color="text3" style={{ marginTop: 6 }}>
            {HOW[os]}
          </Txt>
        </>
      )}
    </View>
  );
}

function Hero({ release, device }: { release: ArkStoreRelease; device: Visitor }) {
  const c = useColors();
  const running = currentArkStoreVersion();
  const inApp = Boolean(desktop) || Platform.OS === 'android';
  const best = recommend(release, device);
  const upToDate = inApp && running && !isNewerVersion(release.version, running);

  let title: string;
  let body: string;
  if (inApp && upToDate) {
    title = "You're on the newest ArkStore";
    body = `Version ${running} on this ${machineName(device)}. Get it on your other devices below and sign in with the same GitHub account.`;
  } else if (inApp && running) {
    title = `ArkStore ${release.version} is out`;
    body = `This ${machineName(device)} has ${running}. ArkStore updates itself: check the Updates tab, or download it again here.`;
  } else if (device.os === 'ios') {
    title = 'Not on iPhone yet';
    body = 'ArkStore installs apps from GitHub, which iOS only allows through the App Store. Get it on Android, Windows, macOS or Linux below.';
  } else if (best) {
    title = `Get ArkStore for ${OS_LABEL[best.os]}`;
    body = `Looks like you're on a ${machineName(device)}. This is the build that works best on it.`;
  } else {
    title = 'Get ArkStore';
    body = device.os ? `No build for ${device.label} in this release yet. Pick another platform below.` : 'Pick your platform below.';
  }

  return (
    <View style={{ marginHorizontal: space.gutter, marginBottom: 22, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
      <DotGrid gap={12} size={1.1} />
      <View style={{ padding: 20, gap: 8 }}>
        <Txt variant="label" color="text2">
          {`Version ${release.version}  ·  ${relativeDate(release.publishedAt).toLowerCase()}`}
        </Txt>
        <Txt variant="title">{title}</Txt>
        <Txt variant="callout" color="text2">
          {body}
        </Txt>
        {best && !upToDate ? (
          <View style={{ marginTop: 10, gap: 6 }}>
            <Button
              label={`Download for ${OS_LABEL[best.os]}`}
              icon={<DownloadSimple size={16} color={c.onInvert} />}
              onPress={() => download(best)}
            />
            <Txt variant="mono" color="text3" style={{ fontSize: 11 }}>
              {fileLabel(best)}  ·  {fileSize(best.size)}
            </Txt>
          </View>
        ) : null}
      </View>
    </View>
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
  // This device's platform first, then the rest.
  const order = device?.os && device.os !== 'ios' ? [device.os, ...ALL_OS.filter((o) => o !== device.os)] : ALL_OS;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar close title="Get ArkStore" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60, paddingTop: 8 }}>
        {latest.isLoading || !device ? (
          <View style={{ padding: space.gutter, gap: 14 }}>
            <Skeleton style={{ height: 180, borderRadius: radius.card }} />
            <Skeleton style={{ height: 140, borderRadius: radius.card }} />
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
            <Hero release={release} device={device} />
            <SectionHeader title="Every platform" />
            {order.map((os) => (
              <PlatformBlock key={os} os={os} release={release} device={device} />
            ))}
            <View style={{ paddingHorizontal: space.gutter, gap: 12, marginTop: 8 }}>
              <Txt variant="callout" color="text2">
                ArkStore keeps itself up to date on every platform. Sign in with GitHub on each device and they all show up
                under Account, where you can sign any of them out.
              </Txt>
              <Tap
                onPress={() => Linking.openURL(release.url)}
                accessibilityRole="link"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}
              >
                <Txt variant="label">Release notes and checksums on GitHub</Txt>
                <ArrowSquareOut size={14} color={c.text} />
              </Tap>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
