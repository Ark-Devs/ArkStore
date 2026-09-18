import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { BellRinging } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { AppRow } from '@/components/store/app-row';
import { ReclaimBanner } from '@/components/store/installer-storage';
import { AppIcon } from '@/components/ui/app-icon';
import { Button } from '@/components/ui/button';
import { DotGrid, DotRule } from '@/components/ui/dots';
import { EmptyState, LargeTitleScreen, SectionHeader } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { plainNotes, relativeDate, shortVersion } from '@/lib/format';
import { installApp, openInstalledApp } from '@/lib/install';
import { useInstalled, type InstalledApp } from '@/lib/stores/installed';
import { friendlyError, supabase } from '@/lib/supabase';
import { askForNotifications, checkForUpdates, notificationsAllowed } from '@/lib/updates';
import { radius, space, useColors } from '@/theme';

function useReleaseNotes(ids: string[]) {
  return useQuery({
    queryKey: ['notes', ...ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('apps').select('id,latest_release_notes').in('id', ids);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.id, r.latest_release_notes as string | null]));
    },
  });
}

function NotifyCard({ onDone }: { onDone: () => void }) {
  const c = useColors();
  return (
    <View style={{ marginHorizontal: space.gutter, marginBottom: 20, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
      <DotGrid gap={12} size={1.1} />
      <View style={{ padding: 18, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <BellRinging size={30} color={c.accent} weight="light" />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="headline">Hear about updates</Txt>
          <Txt variant="callout" color="text2">
            Get a notification when an app you installed ships a new version.
          </Txt>
        </View>
      </View>
      <View style={{ paddingHorizontal: 18, paddingBottom: 18 }}>
        <Button label="Turn on" size="sm" onPress={async () => (await askForNotifications()) && onDone()} />
      </View>
    </View>
  );
}

/** An app on this phone with no pending update. */
function InstalledRow({ app }: { app: InstalledApp }) {
  const c = useColors();
  const canOpen = Platform.OS === 'android' && Boolean(app.packageName);
  return (
    <Tap
      scale={0.98}
      onPress={() => router.push(`/app/${app.appId}`)}
      accessibilityRole="link"
      accessibilityLabel={`${app.name}, version ${app.version}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.gutter, paddingVertical: 8 }}
    >
      <AppIcon uri={app.iconUrl} name={app.name} size={52} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="headline" numberOfLines={1}>
          {app.name}
        </Txt>
        <Txt variant="mono" color="text3" numberOfLines={1} style={{ fontSize: 11 }}>
          {shortVersion(app.version)}  ·  installed {relativeDate(app.installedAt).toLowerCase()}
        </Txt>
      </View>
      {canOpen ? (
        <Tap
          onPress={() => openInstalledApp(app.packageName)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${app.name}`}
          style={{ height: 30, minWidth: 74, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}
        >
          <Txt variant="label" style={{ fontSize: 12, fontFamily: 'SpaceMono_700Bold' }}>
            Open
          </Txt>
        </Tap>
      ) : null}
    </Tap>
  );
}

export default function UpdatesScreen() {
  const installed = useInstalled((s) => s.apps);
  const updates = useInstalled((s) => s.updates);
  const lastCheckedAt = useInstalled((s) => s.lastCheckedAt);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const pending = Object.values(updates).sort((a, b) => a.app.name.localeCompare(b.app.name));
  const onPhone = Object.values(installed)
    .filter((a) => !updates[a.appId])
    .sort((a, b) => a.name.localeCompare(b.name));
  const notes = useReleaseNotes(pending.map((p) => p.appId));

  useEffect(() => {
    if (Platform.OS !== 'web' && Object.keys(installed).length > 0) {
      notificationsAllowed().then((ok) => setNeedsPermission(!ok));
    }
  }, [installed]);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      await checkForUpdates({ notify: false });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setChecking(false);
    }
  };

  const updateAll = async () => {
    for (const u of pending) {
      try {
        await installApp(u.app, 'update');
      } catch (e) {
        Alert.alert(`Couldn't update ${u.app.name}`, friendlyError(e));
        break;
      }
    }
  };

  return (
    <LargeTitleScreen
      title="Updates"
      eyebrow={lastCheckedAt ? `Checked ${relativeDate(lastCheckedAt).toLowerCase()}` : undefined}
      accessory={pending.length > 1 ? <Button label="Update all" size="sm" onPress={updateAll} /> : null}
      refreshing={checking}
      onRefresh={check}
    >
      {needsPermission ? <NotifyCard onDone={() => setNeedsPermission(false)} /> : null}

      {error ? (
        <Txt variant="callout" color="accent" style={{ paddingHorizontal: space.gutter, marginBottom: 12 }}>
          {error}
        </Txt>
      ) : null}

      {Object.keys(installed).length === 0 ? (
        <EmptyState
          glyph="0"
          title="Nothing installed yet"
          body="Apps you get from ArkStore show up here, and so do their updates."
          action={<Button label="Browse apps" onPress={() => router.push('/apps')} />}
        />
      ) : (
        <>
          {pending.length > 0 ? (
            <>
              <SectionHeader title={`${pending.length} ${pending.length === 1 ? 'update' : 'updates'} available`} />
              {pending.map((u, i) => {
                const text = plainNotes(notes.data?.[u.appId]);
                const open = expanded[u.appId];
                return (
                  <View key={u.appId} style={{ marginBottom: 6 }}>
                    {i > 0 ? <DotRule style={{ marginHorizontal: space.gutter, marginBottom: 6 }} /> : null}
                    <AppRow
                      app={u.app}
                      meta={`${shortVersion(u.fromVersion)} → ${shortVersion(u.app.latest_version)}  ·  ${relativeDate(u.app.latest_published_at)}`}
                    />
                    {text ? (
                      <Tap
                        onPress={() => setExpanded((s) => ({ ...s, [u.appId]: !open }))}
                        accessibilityRole="button"
                        accessibilityLabel={open ? 'Show less' : "Show what's new"}
                        style={{ paddingHorizontal: space.gutter, paddingLeft: space.gutter + 74 }}
                      >
                        <Txt variant="callout" color="text2" numberOfLines={open ? undefined : 2}>
                          {text}
                        </Txt>
                        {!open ? (
                          <Txt variant="label" color="text" style={{ marginTop: 4 }}>
                            More
                          </Txt>
                        ) : null}
                      </Tap>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : (
            <EmptyState glyph=":)" title="You're up to date" body="Pull down to check again. New releases also arrive on their own." />
          )}

          {onPhone.length > 0 ? (
            <>
              <View style={{ height: 18 }} />
              <SectionHeader title="On this phone" />
              {onPhone.map((a) => (
                <InstalledRow key={a.appId} app={a} />
              ))}
            </>
          ) : null}
          {Platform.OS === 'android' ? <ReclaimBanner /> : null}
        </>
      )}
    </LargeTitleScreen>
  );
}
