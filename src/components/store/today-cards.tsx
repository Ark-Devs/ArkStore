import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { DotGrid, DotRule } from '@/components/ui/dots';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import type { ListApp } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

import { AppRow } from './app-row';
import { CategoryIcon } from './category-icon';
import { GetButton } from './get-button';

/** "App of the Day": dot-grid canvas, the app's own screenshot leaning in, name in dot-matrix. */
export function FeatureCard({ app, eyebrow, compact }: { app: ListApp; eyebrow: string; compact?: boolean }) {
  const c = useColors();
  const shot = app.screenshots[0];
  return (
    <Tap
      scale={0.98}
      onPress={() => router.push(`/app/${app.id}`)}
      accessibilityRole="link"
      accessibilityLabel={`${eyebrow}: ${app.name}`}
      style={{ marginHorizontal: space.gutter, height: compact ? 360 : 460, borderRadius: radius.card, overflow: 'hidden', backgroundColor: c.surface }}
    >
      <DotGrid gap={13} size={1.3} />
      {shot ? (
        <Image
          source={{ uri: shot }}
          contentFit="cover"
          transition={250}
          style={{
            position: 'absolute',
            right: -34,
            top: 96,
            width: 210,
            height: 440,
            borderRadius: 26,
            borderWidth: 4,
            borderColor: c.surface3,
            transform: [{ rotate: '-7deg' }],
          }}
        />
      ) : (
        <View style={{ position: 'absolute', right: 24, top: compact ? 96 : 120, opacity: 0.9 }}>
          <AppIcon uri={app.icon_url} name={app.name} size={compact ? 120 : 150} />
        </View>
      )}
      <View style={{ padding: 22, gap: 8, width: shot ? '62%' : '70%' }}>
        <Txt variant="label" color="accent">
          {eyebrow}
        </Txt>
        <Txt variant="display" numberOfLines={3}>
          {app.name}
        </Txt>
      </View>
      <LinearGradient
        colors={['transparent', c.surface]}
        locations={[0, 0.55]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 150 }}
      />
      <View
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 12,
          borderRadius: 18,
          backgroundColor: c.surface2,
        }}
      >
        <AppIcon uri={app.icon_url} name={app.name} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="headline" numberOfLines={1}>
            {app.name}
          </Txt>
          <Txt variant="caption" color="text2" numberOfLines={1}>
            {app.subtitle}
          </Txt>
        </View>
        <GetButton app={app} />
      </View>
    </Tap>
  );
}

/** A titled card holding a short list of apps (Today's list stories). */
export function ListCard({
  eyebrow,
  title,
  apps,
  meta,
  onMore,
}: {
  eyebrow: string;
  title: string;
  apps: ListApp[];
  meta?: (app: ListApp) => string | undefined;
  onMore?: () => void;
}) {
  const c = useColors();
  if (apps.length === 0) return null;
  return (
    <View style={{ marginHorizontal: space.gutter, borderRadius: radius.card, backgroundColor: c.surface, paddingVertical: 18 }}>
      <Tap onPress={onMore} disabled={!onMore} style={{ paddingHorizontal: 20, gap: 4, marginBottom: 8 }}>
        <Txt variant="label" color="text2">
          {eyebrow}
        </Txt>
        <Txt variant="title">{title}</Txt>
      </Tap>
      {apps.map((app, i) => (
        <View key={app.id}>
          {i > 0 ? <DotRule style={{ marginLeft: 94, width: '70%' }} /> : null}
          <AppRow app={app} iconSize={54} meta={meta?.(app)} />
        </View>
      ))}
    </View>
  );
}

/** Category story: a big glyph on the dot grid with a stack of icons. */
export function CategoryCard({
  slug,
  icon,
  eyebrow,
  title,
  body,
  apps,
}: {
  slug: string;
  icon: string;
  eyebrow: string;
  title: string;
  body: string;
  apps: ListApp[];
}) {
  const c = useColors();
  return (
    <Tap
      scale={0.98}
      onPress={() => router.push(`/category/${slug}`)}
      accessibilityRole="link"
      accessibilityLabel={title}
      style={{ marginHorizontal: space.gutter, borderRadius: radius.card, backgroundColor: c.invert, overflow: 'hidden', padding: 22, minHeight: 260 }}
    >
      <DotGrid gap={13} size={1.3} color={c.surface3} style={{ opacity: 0.35 }} />
      <View style={{ position: 'absolute', right: -20, top: -10, opacity: 0.18 }}>
        <CategoryIcon name={icon} size={210} color={c.onInvert} />
      </View>
      <Txt variant="label" color="accent">
        {eyebrow}
      </Txt>
      <Txt variant="display" color="onInvert" style={{ marginTop: 8, width: '85%' }}>
        {title}
      </Txt>
      <Txt variant="callout" color="onInvert" style={{ marginTop: 10, opacity: 0.72, width: '85%' }}>
        {body}
      </Txt>
      <View style={{ flexDirection: 'row', marginTop: 18 }}>
        {apps.slice(0, 5).map((a, i) => (
          <View key={a.id} style={{ marginLeft: i === 0 ? 0 : -10, borderRadius: 14, borderWidth: 2, borderColor: c.invert }}>
            <AppIcon uri={a.icon_url} name={a.name} size={46} />
          </View>
        ))}
      </View>
    </Tap>
  );
}
