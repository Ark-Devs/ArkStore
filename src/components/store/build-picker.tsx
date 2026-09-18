import { Check, Cpu } from 'phosphor-react-native';
import { useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DotRule } from '@/components/ui/dots';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { abiLabel, assetAbi, chooseBuild, deviceAbis } from '@/lib/device';
import { fileSize } from '@/lib/format';
import type { ApkAsset } from '@/lib/github/apk';
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
 * Tells people which APK they'll get, picked for their phone's CPU, so nobody has to know
 * what "arm64-v8a" means. Power users can still choose another build.
 */
export function BuildPicker({ app }: { app: ListApp }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const override = usePrefs((s) => s.buildOverride[app.id]);
  const setOverride = usePrefs((s) => s.setBuildOverride);
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
  const detail = choice.matched
    ? `${abiLabel(choice.abi!)} build  ·  ${fileSize(choice.asset.size)}`
    : `${buildName(choice.asset).toLowerCase()} build  ·  ${fileSize(choice.asset.size)}`;
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
              ? `${asset.name}  ·  ${fileSize(asset.size)}`
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
