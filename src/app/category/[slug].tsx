import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';

import { AppRow } from '@/components/store/app-row';
import { CategoryIcon } from '@/components/store/category-icon';
import { DotGrid, DotRule } from '@/components/ui/dots';
import { Chip, EmptyState, RowSkeleton } from '@/components/ui/layout';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useApps, useCategories, type AppOrder } from '@/lib/api';
import { compactNumber, relativeDate, shortVersion } from '@/lib/format';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

const SORTS: { key: AppOrder; label: string }[] = [
  { key: 'stars', label: 'Popular' },
  { key: 'released', label: 'Updated' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'created', label: 'New' },
];

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const c = useColors();
  const [order, setOrder] = useState<AppOrder>('stars');
  const categories = useCategories();
  const apps = useApps(order, { category: slug, limit: 60, featuredFirst: order === 'stars' });
  const category = categories.data?.find((x) => x.slug === slug);

  const meta = (a: NonNullable<typeof apps.data>[number]) =>
    order === 'released'
      ? `${shortVersion(a.latest_version)}  ·  ${relativeDate(a.latest_published_at)}`
      : order === 'downloads'
        ? `${compactNumber(a.downloads)} downloads`
        : `${compactNumber(a.stars)} stars`;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar />
      <FlatList
        data={apps.data ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ paddingBottom: 60 }}
        ListHeaderComponent={
          <View style={{ gap: 18, marginBottom: 12 }}>
            <View style={{ marginHorizontal: space.gutter, height: 150, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden', padding: 20, justifyContent: 'flex-end' }}>
              <DotGrid gap={12} size={1.2} />
              <View style={{ position: 'absolute', right: 18, top: 16 }}>
                <CategoryIcon name={category?.icon} size={64} color={c.text2} />
              </View>
              <Txt variant="display" numberOfLines={2}>
                {category?.name ?? slug}
              </Txt>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: space.gutter }}>
              {SORTS.map((s) => (
                <Chip key={s.key} label={s.label} active={order === s.key} onPress={() => setOrder(s.key)} />
              ))}
            </View>
          </View>
        }
        ItemSeparatorComponent={() => <DotRule style={{ marginLeft: space.gutter + 74, width: '75%' }} />}
        renderItem={({ item, index }) => <AppRow app={item} rank={order === 'stars' ? index + 1 : undefined} meta={meta(item)} />}
        ListEmptyComponent={
          apps.isLoading ? (
            <RowSkeleton count={6} />
          ) : apps.error ? (
            <EmptyState glyph="!?" title="Couldn't load apps" body={friendlyError(apps.error)} />
          ) : (
            <EmptyState glyph="0" title="Nothing here yet" body="Be the first: publish an app in this category from Studio." />
          )
        }
      />
    </View>
  );
}
