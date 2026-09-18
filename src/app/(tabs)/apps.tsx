import { router } from 'expo-router';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { CategoryIcon } from '@/components/store/category-icon';
import { Shelf } from '@/components/store/shelf';
import { FeatureCard } from '@/components/store/today-cards';
import { Button } from '@/components/ui/button';
import { Chip, EmptyState, LargeTitleScreen, SectionHeader } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { useApps, useCategories, useFeatured } from '@/lib/api';
import { compactNumber, relativeDate, shortVersion } from '@/lib/format';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

export default function AppsScreen() {
  const c = useColors();
  const trending = useApps('stars', { limit: 18 });
  const updated = useApps('released', { limit: 12 });
  const downloaded = useApps('downloads', { limit: 12 });
  const categories = useCategories();
  const featured = useFeatured();
  const { width } = useWindowDimensions();

  const refresh = () => {
    featured.refetch();
    trending.refetch();
    updated.refetch();
    downloaded.refetch();
    categories.refetch();
  };

  if (trending.error) {
    return (
      <LargeTitleScreen title="Apps">
        <EmptyState
          glyph="!?"
          title="Couldn't load apps"
          body={friendlyError(trending.error)}
          action={<Button label="Try again" variant="secondary" onPress={refresh} />}
        />
      </LargeTitleScreen>
    );
  }

  return (
    <LargeTitleScreen title="Apps" refreshing={trending.isRefetching} onRefresh={refresh}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.gutter, gap: 8, marginBottom: 22 }}
      >
        {(categories.data ?? []).map((cat) => (
          <Chip
            key={cat.slug}
            label={cat.name}
            icon={<CategoryIcon name={cat.icon} size={16} />}
            onPress={() => router.push(`/category/${cat.slug}`)}
          />
        ))}
      </ScrollView>

      {(featured.data ?? []).length > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={featured.data!.length > 1}
          style={{ marginBottom: 26 }}
        >
          {featured.data!.map((app) => (
            <View key={app.id} style={{ width }}>
              <FeatureCard app={app} eyebrow="Featured" compact />
            </View>
          ))}
        </ScrollView>
      ) : null}

      <SectionHeader title="Trending on GitHub" />
      <Shelf apps={trending.data} loading={trending.isLoading} ranked meta={(a) => `${compactNumber(a.stars)} stars`} />

      <View style={{ height: 26 }} />
      <SectionHeader title="Recently updated" />
      <Shelf
        apps={updated.data}
        loading={updated.isLoading}
        meta={(a) => `${shortVersion(a.latest_version)}  ·  ${relativeDate(a.latest_published_at)}`}
      />

      <View style={{ height: 26 }} />
      <SectionHeader title="Most downloaded here" />
      <Shelf
        apps={downloaded.data}
        loading={downloaded.isLoading}
        meta={(a) => `${compactNumber(a.downloads)} ${a.downloads === 1 ? 'download' : 'downloads'}`}
      />

      <View style={{ height: 26 }} />
      <SectionHeader title="Categories" />
      <View style={{ paddingHorizontal: space.gutter, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {(categories.data ?? []).map((cat) => (
          <Tap
            key={cat.slug}
            onPress={() => router.push(`/category/${cat.slug}`)}
            accessibilityRole="button"
            accessibilityLabel={cat.name}
            style={{
              width: '48.5%',
              height: 76,
              borderRadius: radius.tile,
              backgroundColor: c.surface,
              padding: 14,
              justifyContent: 'space-between',
            }}
          >
            <CategoryIcon name={cat.icon} size={22} />
            <Txt variant="subhead" numberOfLines={1}>
              {cat.name}
            </Txt>
          </Tap>
        ))}
      </View>
    </LargeTitleScreen>
  );
}
