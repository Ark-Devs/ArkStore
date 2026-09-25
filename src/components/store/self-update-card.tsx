import { router } from 'expo-router';
import { ArrowsClockwise } from 'phosphor-react-native/src/icons/ArrowsClockwise';
import { Platform, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { DotGrid } from '@/components/ui/dots';
import { Txt } from '@/components/ui/text';
import { showAlert } from '@/lib/alert';
import { desktop } from '@/lib/desktop';
import { plainNotes } from '@/lib/format';
import {
  androidUpdateAvailable,
  updateArkStoreOnAndroid,
  useAndroidSelfUpdate,
  useDesktopUpdate,
  useLatestArkStore,
} from '@/lib/self-update';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

function Shell({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ marginHorizontal: space.gutter, marginBottom: 20, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
      <DotGrid gap={12} size={1.1} />
      <View style={{ padding: 18, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <ArrowsClockwise size={30} color={c.accent} weight="light" />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="headline">{title}</Txt>
          <Txt variant="callout" color="text2" numberOfLines={3}>
            {body}
          </Txt>
        </View>
      </View>
      {action ? <View style={{ paddingHorizontal: 18, paddingBottom: 18, flexDirection: 'row', gap: 10 }}>{action}</View> : null}
    </View>
  );
}

function DesktopCard() {
  const status = useDesktopUpdate();
  if (!status) return null;
  switch (status.state) {
    case 'available':
      return <Shell title={`ArkStore ${status.version} is out`} body="Downloading it in the background." />;
    case 'downloading':
      return (
        <Shell
          title={`Getting ArkStore ${status.version}`}
          body={`${Math.round(status.progress * 100)}% downloaded. You can keep browsing.`}
        />
      );
    case 'ready':
      return (
        <Shell
          title={`ArkStore ${status.version} is ready`}
          body={plainNotes(status.notes) || 'Restart ArkStore to finish updating. It takes a few seconds.'}
          action={<Button label="Restart to update" size="sm" onPress={() => desktop!.update.install()} />}
        />
      );
    case 'error':
      return status.version ? (
        <Shell
          title={`ArkStore ${status.version} is out`}
          body="It couldn't be installed automatically on this computer. Download it from the ArkStore page."
          action={<Button label="Get ArkStore" size="sm" onPress={() => router.push('/download')} />}
        />
      ) : null;
    default:
      return null;
  }
}

function AndroidCard() {
  const latest = useLatestArkStore(Platform.OS === 'android');
  const task = useAndroidSelfUpdate();
  const release = latest.data;
  if (!release || !androidUpdateAvailable(release)) return null;
  const busy = task.status === 'downloading' || task.status === 'installing';
  const body =
    task.status === 'downloading'
      ? task.progress >= 0
        ? `${Math.round(task.progress * 100)}% downloaded`
        : 'Downloading'
      : plainNotes(release.notes) || 'A new version of ArkStore is ready to install.';
  return (
    <Shell
      title={`ArkStore ${release.version} is available`}
      body={body}
      action={
        <Button
          label={task.status === 'installing' ? 'Installing' : 'Update ArkStore'}
          size="sm"
          loading={busy}
          onPress={() => updateArkStoreOnAndroid(release).catch((e) => showAlert("Couldn't update ArkStore", friendlyError(e)))}
        />
      }
    />
  );
}

/** "ArkStore X is available": shown at the top of Updates on the desktop app and on Android. */
export function SelfUpdateCard() {
  if (desktop) return <DesktopCard />;
  return <AndroidCard />;
}
