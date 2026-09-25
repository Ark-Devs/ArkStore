import { Check } from 'phosphor-react-native/src/icons/Check';
import { Cpu } from 'phosphor-react-native/src/icons/Cpu';
import { Monitor } from 'phosphor-react-native/src/icons/Monitor';
import { useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DotRule } from '@/components/ui/dots';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { desktop } from '@/lib/desktop';
import { abiLabel, assetAbi, buildTarget, chooseBuild, desktopChoices, deviceAbis } from '@/lib/device';
import { downloadEstimate, fileSize } from '@/lib/format';
import type { ApkAsset } from '@/lib/github/apk';
import { archLabel, fileLabel, OS_LABEL, type ReleaseFile } from '@/lib/github/assets';
import { usePrefs } from '@/lib/stores/prefs';
import type { ListApp } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

function buildName(asset: ApkAsset) {
  const abi = assetAbi(asset.name);
  if (abi === 'universal') return 'Universal';
  if (abi) return abiLabel(abi);
  return 'Standard';
}

/**
 * Tells people which file they'll get, picked for their phone's CPU or their computer, so
 * nobody has to know what "arm64-v8a" or "AppImage" means. Power users can still choose.
 */
export function BuildPicker({ app }: { app: ListApp }) {
  const target = buildTarget();
  if (target && target.os !== 'android' && desktopChoices(app, target).length > 0) return <DesktopBuildPicker app={app} />;
  // The desktop app never offers APKs; browsers fall back to the APK (for a phone).
  if (desktop) return null;
  return <ApkBuildPicker app={app} />;
}

function ApkBuildPicker({ app }: { app: ListApp }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const override = usePrefs((s) => s.buildOverride[app.id]);
  const setOverride = usePrefs((s) => s.setBuildOverride);
  const speed = usePrefs((s) => s.downloadSpeed);
  const assets = app.apk_assets ?? [];
  const choice = chooseBuild(assets, { name: app.apk_name, url: app.apk_url, size: app.apk_size }, override);
  if (!choice) return null;

  const abis = deviceAbis();
  const multiple = assets.length > 1;
  const title = choice.manual
    ? `${buildName(choice.asset)} build, picked by you`
    : choice.matched
      ? 'Built for your phone'
      : multiple
        ? 'Works on any phone'
        : 'One build for every phone';
  const estimate = downloadEstimate(choice.asset.size, speed);
  const detail = [
    choice.matched ? `${abiLabel(choice.abi!)} build` : `${buildName(choice.asset).toLowerCase()} build`,
    fileSize(choice.asset.size),
    estimate,
  ]
    .filter(Boolean)
    .join('  ·  ');
  const auto = chooseBuild(assets, { name: app.apk_name, url: app.apk_url, size: app.apk_size });

  return (
    <>
      <View
        style={{
          marginHorizontal: space.gutter,
          borderRadius: radius.tile,
          backgroundColor: c.surface,
          padding: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Cpu size={26} color={choice.matched ? c.accent : c.text2} weight="light" />
        <View style={{ flex: 1 }}>
          <Txt variant="subhead">{title}</Txt>
          <Txt variant="mono" color="text2" style={{ fontSize: 11 }}>
            {detail}
          </Txt>
        </View>
        {multiple ? (
          <Tap onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Choose another build">
            <Txt variant="label">Change</Txt>
          </Tap>
        ) : null}
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: c.surface,
            borderTopLeftRadius: radius.card,
            borderTopRightRadius: radius.card,
            paddingTop: 10,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.surface3, marginBottom: 14 }} />
          <View style={{ paddingHorizontal: space.gutter, gap: 4, marginBottom: 10 }}>
            <Txt variant="section">Choose a build</Txt>
            <Txt variant="callout" color="text2">
              {Platform.OS === 'android' && abis.length
                ? `This phone runs ${abis.map(abiLabel).join(', ')}. Automatic picks the smallest build that fits.`
                : 'Automatic picks the smallest build that fits the phone.'}
            </Txt>
          </View>
          {[null, ...assets].map((asset, i) => {
            const selected = asset ? override === asset.name : !override;
            const label = asset ? buildName(asset) : 'Automatic';
            const sub = asset
              ? [asset.name, fileSize(asset.size), downloadEstimate(asset.size, speed)].filter(Boolean).join('  ·  ')
              : auto
                ? `Currently ${buildName(auto.asset).toLowerCase()}  ·  ${fileSize(auto.asset.size)}`
                : '';
            return (
              <View key={asset?.name ?? 'auto'}>
                {i > 0 ? <DotRule style={{ marginHorizontal: space.gutter }} /> : null}
                <Tap
                  scale={0.99}
                  onPress={() => {
                    setOverride(app.id, asset?.name ?? null);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.gutter, paddingVertical: 12, gap: 12 }}
                >
                  <View style={{ flex: 1 }}>
                    <Txt variant="headline">{label}</Txt>
                    <Txt variant="mono" color="text3" numberOfLines={1} style={{ fontSize: 11 }}>
                      {sub}
                    </Txt>
                  </View>
                  {selected ? <Check size={20} color={c.accent} weight="bold" /> : null}
                </Tap>
              </View>
            );
          })}
        </View>
      </Modal>
    </>
  );
}

function DesktopBuildPicker({ app }: { app: ListApp }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const override = usePrefs((s) => s.buildOverride[app.id]);
  const setOverride = usePrefs((s) => s.setBuildOverride);
  const speed = usePrefs((s) => s.downloadSpeed);
  const target = buildTarget()!;
  const choices = desktopChoices(app, target);
  const auto = choices[0];
  const chosen = choices.find((f) => f.name === override) ?? auto;
  if (!chosen) return null;

  const where = target.os === 'macos' ? 'Mac' : target.os === 'windows' ? 'PC' : 'computer';
  const exact = Boolean(target.arch && chosen.arch === target.arch);
  const title = chosen !== auto ? 'Picked by you' : exact ? `Built for your ${where}` : `Runs on your ${where}`;
  const detail = [fileLabel(chosen), fileSize(chosen.size), downloadEstimate(chosen.size, speed)].filter(Boolean).join('  ·  ');
  const machine = [OS_LABEL[target.os], archLabel(target.arch)].filter(Boolean).join(' ');

  const row = (file: ReleaseFile | null, i: number) => {
    const selected = file ? override === file.name : !override || !choices.some((f) => f.name === override);
    const label = file ? fileLabel(file) : 'Automatic';
    const sub = file
      ? [file.name, fileSize(file.size), downloadEstimate(file.size, speed)].filter(Boolean).join('  ·  ')
      : `Currently ${fileLabel(auto).toLowerCase()}  ·  ${fileSize(auto.size)}`;
    return (
      <View key={file?.name ?? 'auto'}>
        {i > 0 ? <DotRule style={{ marginHorizontal: space.gutter }} /> : null}
        <Tap
          scale={0.99}
          onPress={() => {
            setOverride(app.id, file?.name ?? null);
            setOpen(false);
          }}
          accessibilityRole="radio"
          accessibilityState={{ selected }}
          style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.gutter, paddingVertical: 12, gap: 12 }}
        >
          <View style={{ flex: 1 }}>
            <Txt variant="headline">{label}</Txt>
            <Txt variant="mono" color="text3" numberOfLines={1} style={{ fontSize: 11 }}>
              {sub}
            </Txt>
          </View>
          {selected ? <Check size={20} color={c.accent} weight="bold" /> : null}
        </Tap>
      </View>
    );
  };

  return (
    <>
      <View
        style={{
          marginHorizontal: space.gutter,
          borderRadius: radius.tile,
          backgroundColor: c.surface,
          padding: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Monitor size={26} color={exact ? c.accent : c.text2} weight="light" />
        <View style={{ flex: 1 }}>
          <Txt variant="subhead">{title}</Txt>
          <Txt variant="mono" color="text2" style={{ fontSize: 11 }}>
            {detail}
          </Txt>
        </View>
        {choices.length > 1 ? (
          <Tap onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Choose another download">
            <Txt variant="label">Change</Txt>
          </Tap>
        ) : null}
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: c.surface,
            borderTopLeftRadius: radius.card,
            borderTopRightRadius: radius.card,
            paddingTop: 10,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.surface3, marginBottom: 14 }} />
          <View style={{ paddingHorizontal: space.gutter, gap: 4, marginBottom: 10 }}>
            <Txt variant="section">Choose a download</Txt>
            <Txt variant="callout" color="text2">
              {`This computer runs ${machine}. Automatic picks the installer that sets ${app.name} up for you.`}
            </Txt>
          </View>
          {[null, ...choices].map(row)}
        </View>
      </Modal>
    </>
  );
}
