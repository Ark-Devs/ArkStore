import { router } from 'expo-router';
import { ArrowsClockwise } from 'phosphor-react-native/src/icons/ArrowsClockwise';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { showAlert } from '@/lib/alert';
import { desktop } from '@/lib/desktop';
import { updateArkStoreOnAndroid, useAndroidSelfUpdate, useArkStoreUpdate } from '@/lib/self-update';
import { usePrefs } from '@/lib/stores/prefs';
import { friendlyError } from '@/lib/supabase';
import { radius, useColors } from '@/theme';

/**
 * "ArkStore 1.3.0 is available", floating above the tab bar on every screen as soon as a new
 * ArkStore release is on GitHub. The button does whatever this platform needs: install the
 * APK, restart into the downloaded update, or open the download page.
 */
export function UpdateBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const update = useArkStoreUpdate();
  const task = useAndroidSelfUpdate();
  const hidden = usePrefs((s) => s.hiddenSelfUpdate);
  const hide = usePrefs((s) => s.hideSelfUpdate);
  if (!update || (hidden === update.version && update.kind !== 'restart')) return null;

  let body = 'Tap Update to get it.';
  let action: { label: string; run: () => void } | null = null;
  switch (update.kind) {
    case 'install':
      body =
        task.status === 'downloading'
          ? task.progress >= 0
            ? `Downloading, ${Math.round(task.progress * 100)}%`
            : 'Downloading'
          : task.status === 'installing'
            ? 'Opening the installer'
            : 'A new version of ArkStore is ready to install.';
      action =
        task.status === 'downloading' || task.status === 'installing'
          ? null
          : {
              label: 'Update',
              run: () => updateArkStoreOnAndroid(update.release).catch((e) => showAlert("Couldn't update ArkStore", friendlyError(e))),
            };
      break;
    case 'downloading':
      body = `Downloading in the background, ${Math.round(update.progress * 100)}%`;
      break;
    case 'restart':
      body = 'Downloaded. Restart ArkStore to finish updating.';
      action = { label: 'Restart', run: () => desktop?.update.install() };
      break;
    case 'download':
      body = 'Download the new version to update.';
      action = { label: 'Get it', run: () => router.push('/download') };
      break;
  }

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 12,
          paddingLeft: 14,
          borderRadius: radius.tile,
          backgroundColor: c.invert,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        },
        style,
      ]}
      accessibilityRole="alert"
    >
      <ArrowsClockwise size={22} color={c.accent} weight="bold" />
      <Tap scale={0.99} onPress={() => router.push('/updates')} style={{ flex: 1 }} accessibilityRole="link">
        <Txt variant="subhead" color="onInvert">
          ArkStore {update.version} is available
        </Txt>
        <Txt variant="caption" color="onInvert" style={{ opacity: 0.7 }} numberOfLines={1}>
          {body}
        </Txt>
      </Tap>
      {update.kind !== 'restart' ? (
        <Tap onPress={() => hide(update.version)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remind me later">
          <Txt variant="label" color="onInvert" style={{ opacity: 0.6 }}>
            Later
          </Txt>
        </Tap>
      ) : null}
      {action ? (
        <Tap
          onPress={action.run}
          accessibilityRole="button"
          style={{ height: 32, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
        >
          <Txt variant="label" color="onAccent" style={{ fontFamily: 'SpaceMono_700Bold' }}>
            {action.label}
          </Txt>
        </Tap>
      ) : null}
    </View>
  );
}
