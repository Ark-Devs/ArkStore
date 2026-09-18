import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ArrowsClockwise, EyeSlash, Eye, GithubLogo, PencilSimple, Plus, Trash } from 'phosphor-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { AppRow } from '@/components/store/app-row';
import { AppIcon } from '@/components/ui/app-icon';
import { Button } from '@/components/ui/button';
import { DotGrid, DotRule } from '@/components/ui/dots';
import { EmptyState, LargeTitleScreen, RowSkeleton, SectionHeader } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { useClaimable, useMyApps, useMyStats } from '@/lib/api';
import { getGitHubToken, githubProfile, signInWithGitHub, useAuth } from '@/lib/auth';
import { compactNumber, relativeDate, shortVersion } from '@/lib/format';
import { deleteListing, refreshListing, updateListing } from '@/lib/publish';
import { friendlyError, isConfigured } from '@/lib/supabase';
import type { DownloadDay, StoreApp } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

const STEPS = [
  ['Link a repo', 'Paste any public GitHub repo, or pick one of yours.'],
  ['ArkStore reads it', 'Icon, screenshots, description and the APK in your latest release.'],
  ['Publish', 'Every new GitHub release reaches your users as an update. No re-uploading.'],
];

function SignedOut() {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    try {
      await signInWithGitHub();
    } catch (e) {
      Alert.alert("Couldn't sign in", friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginHorizontal: space.gutter, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
      <DotGrid gap={13} size={1.3} />
      <View style={{ padding: 22, gap: 18 }}>
        <Txt variant="label" color="accent">
          For developers
        </Txt>
        <Txt variant="display">Ship your app straight from GitHub</Txt>
        <View style={{ gap: 14 }}>
          {STEPS.map(([title, body], i) => (
            <View key={title} style={{ flexDirection: 'row', gap: 14 }}>
              <Txt variant="number" color="text3" style={{ width: 20 }}>
                {i + 1}
              </Txt>
              <View style={{ flex: 1 }}>
                <Txt variant="headline">{title}</Txt>
                <Txt variant="callout" color="text2">
                  {body}
                </Txt>
              </View>
            </View>
          ))}
        </View>
        <Button
          label="Sign in with GitHub"
          size="lg"
          full
          loading={busy}
          disabled={!isConfigured}
          icon={<GithubLogo size={20} color={c.onInvert} weight="fill" />}
          onPress={signIn}
        />
        {!isConfigured ? (
          <Txt variant="caption" color="accent">
            Supabase isn't configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY to .env.
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

/** Last 14 days of downloads as dot-capped bars. */
function Sparkline({ days }: { days: DownloadDay[] }) {
  const c = useColors();
  const series = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
    const row = days.find((x) => x.day === d);
    return row?.downloads ?? 0;
  });
  const max = Math.max(1, ...series);
  return (
    <View
      accessibilityLabel={`Downloads over the last 14 days: ${series.join(', ')}`}
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 30 }}
    >
      {series.map((v, i) => (
        <View
          key={i}
          style={{
            width: 5,
            height: v === 0 ? 5 : Math.max(5, (v / max) * 30),
            borderRadius: 3,
            backgroundColor: v === 0 ? c.surface3 : i === 13 ? c.accent : c.text,
          }}
        />
      ))}
    </View>
  );
}

function MyAppCard({ app, stats }: { app: StoreApp; stats: DownloadDay[] }) {
  const c = useColors();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const installs30 = stats.reduce((sum, d) => sum + d.installs, 0);
  const live = app.status === 'published';

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await fn();
      await qc.invalidateQueries();
    } catch (e) {
      Alert.alert('Something went wrong', friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const actions = [
    { key: 'edit', label: 'Edit', icon: PencilSimple, onPress: () => router.push(`/publish?edit=${app.id}`) },
    {
      key: 'sync',
      label: 'Sync',
      icon: ArrowsClockwise,
      onPress: () => act('sync', async () => refreshListing(app.id, await getGitHubToken())),
    },
    {
      key: 'visibility',
      label: live ? 'Hide' : 'Show',
      icon: live ? EyeSlash : Eye,
      onPress: () => act('visibility', () => updateListing(app.id, { status: live ? 'hidden' : 'published' })),
    },
    {
      key: 'delete',
      label: 'Remove',
      icon: Trash,
      onPress: () =>
        Alert.alert(`Remove ${app.name}?`, 'It disappears from ArkStore. Download history is deleted too.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => act('delete', () => deleteListing(app.id)) },
        ]),
    },
  ];

  return (
    <View style={{ marginHorizontal: space.gutter, marginBottom: 14, borderRadius: radius.card, backgroundColor: c.surface, padding: 18, gap: 16 }}>
      <Tap scale={0.99} onPress={() => router.push(`/app/${app.id}`)} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <AppIcon uri={app.icon_url} name={app.name} size={56} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="headline" numberOfLines={1}>
            {app.name}
          </Txt>
          <Txt variant="mono" color="text3" numberOfLines={1} style={{ fontSize: 11 }}>
            {shortVersion(app.latest_version)}
            {app.latest_prerelease ? ' beta' : ''}  ·  synced {relativeDate(app.last_synced_at).toLowerCase() || 'never'}
          </Txt>
        </View>
        <View
          style={{
            paddingHorizontal: 10,
            height: 24,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: live ? c.accent : c.line,
            justifyContent: 'center',
          }}
        >
          <Txt variant="label" color={live ? 'accent' : 'text3'} style={{ fontSize: 9.5 }}>
            {live ? 'Live' : 'Hidden'}
          </Txt>
        </View>
      </Tap>

      <DotRule />

      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Txt variant="label" color="text3">
            Downloads
          </Txt>
          <Txt variant="display" size={30}>
            {compactNumber(app.downloads)}
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="label" color="text3">
            Installs
          </Txt>
          <Txt variant="display" size={30}>
            {compactNumber(app.installs)}
          </Txt>
          <Txt variant="caption" color="text3">
            {installs30} in 30 days
          </Txt>
        </View>
        <Sparkline days={stats} />
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {actions.map((a) => (
          <Tap
            key={a.key}
            onPress={a.onPress}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={`${a.label} ${app.name}`}
            style={{
              flex: 1,
              height: 40,
              borderRadius: radius.pill,
              backgroundColor: c.surface2,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
            }}
          >
            <a.icon size={16} color={a.key === 'delete' ? c.accent : c.text} />
            <Txt variant="caption" color={a.key === 'delete' ? 'accent' : 'text'}>
              {busy === a.key ? '...' : a.label}
            </Txt>
          </Tap>
        ))}
      </View>
    </View>
  );
}

export default function StudioScreen() {
  const c = useColors();
  const session = useAuth((s) => s.session);
  const ready = useAuth((s) => s.ready);
  const profile = githubProfile(session);
  const uid = session?.user.id;
  const mine = useMyApps(uid);
  const claimable = useClaimable(profile?.login);
  const ids = (mine.data ?? []).map((a) => a.id);
  const stats = useMyStats(uid, ids);

  const refresh = () => {
    mine.refetch();
    claimable.refetch();
    stats.refetch();
  };

  return (
    <LargeTitleScreen
      title="Studio"
      eyebrow={profile ? `@${profile.login}` : 'Publish on ArkStore'}
      accessory={
        profile?.avatar ? (
          <Tap onPress={() => router.push('/account')} accessibilityRole="button" accessibilityLabel="Account">
            <Image source={{ uri: profile.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface2 }} />
          </Tap>
        ) : null
      }
      refreshing={mine.isRefetching}
      onRefresh={session ? refresh : undefined}
    >
      {!ready ? (
        <RowSkeleton count={2} />
      ) : !session ? (
        <SignedOut />
      ) : (
        <>
          <View style={{ paddingHorizontal: space.gutter, marginBottom: 24 }}>
            <Button
              label="Publish an app"
              size="lg"
              full
              icon={<Plus size={18} color={c.onInvert} weight="bold" />}
              onPress={() => router.push('/publish')}
            />
          </View>

          {(claimable.data ?? []).length > 0 ? (
            <>
              <SectionHeader title="Already on ArkStore" />
              <Txt variant="callout" color="text2" style={{ paddingHorizontal: space.gutter, marginBottom: 8 }}>
                We listed these from your GitHub. Claim them to edit the page and see downloads.
              </Txt>
              {claimable.data!.map((a) => (
                <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', paddingRight: space.gutter }}>
                  <View style={{ flex: 1 }}>
                    <AppRow app={a} showButton={false} iconSize={52} />
                  </View>
                  <Button label="Claim" size="sm" onPress={() => router.push(`/publish?repo=${encodeURIComponent(a.repo_full_name)}`)} />
                </View>
              ))}
              <View style={{ height: 20 }} />
            </>
          ) : null}

          <SectionHeader title="Your apps" />
          {mine.isLoading ? (
            <RowSkeleton count={2} />
          ) : mine.error ? (
            <EmptyState glyph="!?" title="Couldn't load your apps" body={friendlyError(mine.error)} />
          ) : ids.length === 0 ? (
            <EmptyState
              glyph="+"
              title="No apps yet"
              body="Publish a repo that has an APK attached to a GitHub release. It takes about a minute."
            />
          ) : (
            (mine.data ?? []).map((app) => (
              <MyAppCard key={app.id} app={app} stats={(stats.data ?? []).filter((d) => d.app_id === app.id)} />
            ))
          )}
        </>
      )}
    </LargeTitleScreen>
  );
}
