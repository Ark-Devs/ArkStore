import { router, useLocalSearchParams } from 'expo-router';
import { CaretRight } from 'phosphor-react-native/src/icons/CaretRight';
import { Star } from 'phosphor-react-native/src/icons/Star';
import { useState } from 'react';
import { Linking, ScrollView, Share, View } from 'react-native';

import { BuildPicker } from '@/components/store/build-picker';
import { CategoryIcon } from '@/components/store/category-icon';
import { GetButton } from '@/components/store/get-button';
import { ScreenshotStrip } from '@/components/store/screenshots';
import { Shelf } from '@/components/store/shelf';
import { StarCard } from '@/components/store/star-card';
import { StatsStrip, type Stat } from '@/components/store/stats-strip';
import { AppIcon } from '@/components/ui/app-icon';
import { Button } from '@/components/ui/button';
import { DotRule } from '@/components/ui/dots';
import { EmptyState, SectionHeader, Skeleton } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useApp, useCategories, useDeveloperApps } from '@/lib/api';
import { desktop } from '@/lib/desktop';
import { pickDownload } from '@/lib/device';
import { OS_LABEL } from '@/lib/github/assets';
import {
  androidVersion,
  compactNumber,
  downloadEstimate,
  fileSize,
  longDate,
  plainNotes,
  relativeDate,
  shortVersion,
} from '@/lib/format';
import { profileUrl, repoUrl } from '@/lib/github/repo';
import { usePrefs } from '@/lib/stores/prefs';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

function InfoRow({ label, value, onPress }: { label: string; value: string | null | undefined; onPress?: () => void }) {
  const c = useColors();
  if (!value) return null;
  return (
    <>
      <Tap
        disabled={!onPress}
        onPress={onPress}
        scale={0.99}
        accessibilityRole={onPress ? 'link' : 'text'}
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, gap: 16 }}
      >
        <Txt variant="callout" color="text2">
          {label}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
          <Txt variant="callout" numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>
            {value}
          </Txt>
          {onPress ? <CaretRight size={14} color={c.text3} /> : null}
        </View>
      </Tap>
      <DotRule />
    </>
  );
}

function Collapsible({ text, lines }: { text: string; lines: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 60 || text.split('\n').length > lines;
  return (
    <Tap disabled={!long} onPress={() => setOpen((o) => !o)} scale={1} accessibilityRole={long ? 'button' : 'text'}>
      <Txt variant="body" color="text2" numberOfLines={open ? undefined : lines}>
        {text}
      </Txt>
      {long && !open ? (
        <Txt variant="label" style={{ marginTop: 6 }}>
          More
        </Txt>
      ) : null}
    </Tap>
  );
}

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { data: app, isLoading, error, refetch } = useApp(id);
  const categories = useCategories();
  const more = useDeveloperApps(app?.developer_login);
  const override = usePrefs((s) => (id ? s.buildOverride[id] : undefined));
  const speed = usePrefs((s) => s.downloadSpeed);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <TopBar />
        <View style={{ padding: space.gutter, gap: 18 }}>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Skeleton style={{ width: 118, height: 118, borderRadius: 27 }} />
            <View style={{ flex: 1, gap: 10, paddingTop: 8 }}>
              <Skeleton style={{ height: 22, width: '70%' }} />
              <Skeleton style={{ height: 14, width: '90%' }} />
              <Skeleton style={{ height: 40, width: 120, borderRadius: 20, marginTop: 10 }} />
            </View>
          </View>
          <Skeleton style={{ height: 70 }} />
          <Skeleton style={{ height: 400, width: 200, borderRadius: 20 }} />
        </View>
      </View>
    );
  }

  if (error || !app) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <TopBar />
        <EmptyState
          glyph="404"
          title="App not found"
          body={error ? friendlyError(error) : 'It may have been removed by its developer.'}
          action={<Button label="Try again" variant="secondary" onPress={() => refetch()} />}
        />
      </View>
    );
  }

  const category = categories.data?.find((cat) => cat.slug === app.category);
  const build = pickDownload(app, override);
  const available = (app.platforms ?? []).map((p) => OS_LABEL[p]).join(', ');
  const notes = plainNotes(app.latest_release_notes);
  const others = (more.data ?? []).filter((a) => a.id !== app.id);

  const stats: Stat[] = [
    { label: 'Downloads', value: compactNumber(app.downloads), caption: 'on ArkStore' },
    { label: 'Installs', value: compactNumber(app.installs), caption: 'confirmed' },
    {
      label: 'Stars',
      value: (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Txt variant="number">{compactNumber(app.stars)}</Txt>
          <Star size={14} color={c.text} weight="fill" />
        </View>
      ),
      caption: 'on GitHub',
    },
    { label: 'Category', value: <CategoryIcon name={category?.icon} size={24} />, caption: category?.name ?? app.category },
    { label: 'Version', value: shortVersion(app.latest_version) || '-', caption: app.latest_prerelease ? 'beta' : relativeDate(app.latest_published_at) },
    {
      label: 'Size',
      value: fileSize(build?.size),
      caption: downloadEstimate(build?.size, speed) ?? (build?.matched ? (desktop ? 'for this computer' : 'for this phone') : 'download'),
    },
    ...(app.min_sdk ? [{ label: 'Requires', value: androidVersion(app.min_sdk)!.replace('Android ', ''), caption: 'Android' }] : []),
    ...(app.license ? [{ label: 'License', value: app.license.replace(/-only|-or-later/i, ''), caption: 'open source' }] : []),
  ];

  const share = () =>
    Share.share({ message: `${app.name} on ArkStore: ${app.subtitle}\n${repoUrl(app.repo_full_name)}` }).catch(() => undefined);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar onShare={share} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={{ paddingHorizontal: space.gutter, paddingTop: 8, flexDirection: 'row', gap: 16 }}>
          <AppIcon uri={app.icon_url} name={app.name} size={118} />
          <View style={{ flex: 1, minWidth: 0, justifyContent: 'space-between', paddingVertical: 2 }}>
            <View style={{ gap: 2 }}>
              <Txt variant="title" numberOfLines={2}>
                {app.name}
              </Txt>
              <Txt variant="callout" color="text2" numberOfLines={2}>
                {app.subtitle}
              </Txt>
              <Tap onPress={() => Linking.openURL(profileUrl(app.developer_login))} accessibilityRole="link" style={{ alignSelf: 'flex-start' }}>
                <Txt variant="label" color="text3" style={{ marginTop: 4 }}>
                  {app.developer_login}
                </Txt>
              </Tap>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <GetButton app={app} size="lg" />
              {app.latest_prerelease ? (
                <View style={{ paddingHorizontal: 9, height: 22, borderRadius: radius.pill, borderWidth: 1, borderColor: c.line, justifyContent: 'center' }}>
                  <Txt variant="label" color="text2" style={{ fontSize: 9.5 }}>
                    Beta
                  </Txt>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <DotRule style={{ marginHorizontal: space.gutter, marginVertical: 18 }} />
        <StatsStrip stats={stats} />
        <DotRule style={{ marginHorizontal: space.gutter, marginVertical: 18 }} />

        <BuildPicker app={app} />

        {app.screenshots.length > 0 ? (
          <View style={{ marginTop: 22 }}>
            <ScreenshotStrip urls={app.screenshots} appName={app.name} />
          </View>
        ) : null}

        {app.description ? (
          <View style={{ paddingHorizontal: space.gutter, marginTop: 24 }}>
            <Collapsible text={app.description} lines={4} />
          </View>
        ) : null}

        <View style={{ height: 26 }} />
        <SectionHeader
          title="What's new"
          action="Version history"
          onAction={() => router.push(`/app/${app.id}/versions`)}
        />
        <View style={{ paddingHorizontal: space.gutter, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="mono" color="text2">
              {app.latest_version}
              {app.latest_prerelease ? '  (beta)' : ''}
            </Txt>
            <Txt variant="mono" color="text3">
              {relativeDate(app.latest_published_at)}
            </Txt>
          </View>
          {notes ? <Collapsible text={notes} lines={4} /> : <Txt variant="callout" color="text3">No release notes for this version.</Txt>}
        </View>

        <View style={{ height: 30 }} />
        <StarCard
          name={app.name}
          repo={app.repo_full_name}
          developer={app.developer_login}
          avatar={app.developer_avatar}
          stars={app.stars}
        />

        <View style={{ height: 26 }} />
        <SectionHeader title="Information" />
        <View style={{ paddingHorizontal: space.gutter }}>
          <InfoRow label="Developer" value={`@${app.developer_login}`} onPress={() => Linking.openURL(profileUrl(app.developer_login))} />
          {app.publisher_login && app.publisher_login.toLowerCase() !== app.developer_login.toLowerCase() ? (
            <InfoRow label="Published by" value={`@${app.publisher_login}`} onPress={() => Linking.openURL(profileUrl(app.publisher_login!))} />
          ) : null}
          <InfoRow label="Source code" value={app.repo_full_name} onPress={() => Linking.openURL(repoUrl(app.repo_full_name))} />
          {app.homepage ? <InfoRow label="Website" value={app.homepage.replace(/^https:\/\//, '')} onPress={() => Linking.openURL(app.homepage!)} /> : null}
          <InfoRow label="Category" value={category?.name} onPress={() => router.push(`/category/${app.category}`)} />
          <InfoRow label="Size" value={fileSize(build?.size)} />
          <InfoRow label="Available for" value={available} />
          <InfoRow label="Compatibility" value={androidVersion(app.min_sdk)} />
          <InfoRow label="Package" value={app.package_name} />
          <InfoRow label="License" value={app.license} />
          <InfoRow label="Updated" value={longDate(app.latest_published_at)} />
          <InfoRow label="Listed" value={app.source === 'curated' ? 'By ArkStore, from GitHub' : 'By the developer'} />
        </View>

        {others.length > 0 ? (
          <>
            <View style={{ height: 26 }} />
            <SectionHeader title={`More from ${app.developer_login}`} />
            <Shelf apps={others} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
