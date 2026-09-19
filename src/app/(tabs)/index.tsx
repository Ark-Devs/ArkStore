import { Image } from 'expo-image';
import { router } from 'expo-router';
import { UserCircle } from 'phosphor-react-native/src/icons/UserCircle';
import { View } from 'react-native';

import { CategoryCard, FeatureCard, ListCard } from '@/components/store/today-cards';
import { Button } from '@/components/ui/button';
import { EmptyState, LargeTitleScreen, Skeleton } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { useApps, useCategories, useFeatured } from '@/lib/api';
import { githubProfile, useAuth } from '@/lib/auth';
import { compactNumber, relativeDate, shortVersion, todayLabel } from '@/lib/format';
import { friendlyError } from '@/lib/supabase';
import type { ListApp } from '@/lib/types';
import { space, useColors } from '@/theme';

const STORIES: Record<string, { title: string; body: string }> = {
  security: { title: 'Take back your privacy', body: 'Open source apps that keep your data on your phone, where it belongs.' },
  'music-audio': { title: 'Sound, unlocked', body: 'Players and streamers built by people who just love music.' },
  video: { title: 'Watch it your way', body: 'Downloaders and players with no ads between you and the good part.' },
  tools: { title: 'Small tools, big wins', body: 'Little utilities that fix one annoying thing really well.' },
  files: { title: 'Your files, no cloud', body: 'Move, convert and open anything without uploading it anywhere.' },
  productivity: { title: 'Get it done, offline', body: 'Focused apps that work without an account or a signal.' },
  developer: { title: 'Built for builders', body: 'Terminals, clients and inspectors for when your phone is your laptop.' },
  news: { title: 'Read without the feed', body: 'Readers that show you what you subscribed to. Nothing else.' },
  games: { title: 'Play something honest', body: 'Games and game tools without loot boxes or timers.' },
};

const dayIndex = () => Math.floor(Date.now() / 86_400_000);

function rotate<T>(list: T[], offset = 0): T | undefined {
  return list.length ? list[(dayIndex() + offset) % list.length] : undefined;
}

function AccountButton() {
  const c = useColors();
  const profile = githubProfile(useAuth((s) => s.session));
  return (
    <Tap onPress={() => router.push('/account')} accessibilityRole="button" accessibilityLabel="Account and settings" hitSlop={8}>
      {profile?.avatar ? (
        <Image source={{ uri: profile.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface2 }} />
      ) : (
        <UserCircle size={36} color={c.text} weight="thin" />
      )}
    </Tap>
  );
}

export default function TodayScreen() {
  const popular = useApps('stars', { limit: 40 });
  const fresh = useApps('released', { limit: 5 });
  const newest = useApps('created', { limit: 5 });
  const categories = useCategories();
  const featuredQuery = useFeatured();

  const all = popular.data ?? [];
  const withArt = all.filter((a) => a.screenshots.length > 0);
  // Featured apps (apps.featured) always win App of the Day, rotating if there are several.
  const featured = featuredQuery.data ?? [];
  const appOfDay = rotate(featured.length ? featured : withArt.length ? withArt : all);
  const indie = rotate(
    withArt.filter((a) => a.stars < 3000 && a.id !== appOfDay?.id),
    3,
  );

  // Today's category story: rotate through categories that have at least three apps.
  const byCategory = new Map<string, ListApp[]>();
  for (const a of all) byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a]);
  const storyCategories = (categories.data ?? []).filter((c) => (byCategory.get(c.slug)?.length ?? 0) >= 2);
  const story = rotate(storyCategories, 1);

  const refreshing = popular.isRefetching || fresh.isRefetching;
  const refresh = () => {
    popular.refetch();
    fresh.refetch();
    newest.refetch();
    featuredQuery.refetch();
  };

  return (
    <LargeTitleScreen
      title="Today"
      eyebrow={todayLabel()}
      accessory={<AccountButton />}
      refreshing={refreshing}
      onRefresh={refresh}
    >
      {popular.isLoading ? (
        <View style={{ paddingHorizontal: space.gutter, gap: 20 }}>
          <Skeleton style={{ height: 460, borderRadius: 22 }} />
          <Skeleton style={{ height: 300, borderRadius: 22 }} />
        </View>
      ) : popular.error ? (
        <EmptyState
          glyph="!?"
          title="Couldn't load the store"
          body={friendlyError(popular.error)}
          action={<Button label="Try again" variant="secondary" onPress={refresh} />}
        />
      ) : all.length === 0 ? (
        <EmptyState
          glyph="0"
          title="The shelves are empty"
          body="No apps are listed yet. Publish the first one from Studio."
          action={<Button label="Open Studio" onPress={() => router.push('/studio')} />}
        />
      ) : (
        <View style={{ gap: 24 }}>
          {appOfDay ? <FeatureCard app={appOfDay} eyebrow="App of the day" /> : null}

          <ListCard
            eyebrow="Fresh releases"
            title="Updated this week"
            apps={fresh.data ?? []}
            meta={(a) => `${shortVersion(a.latest_version)}  ·  ${relativeDate(a.latest_published_at)}`}
            onMore={() => router.push('/apps')}
          />

          {story ? (
            <CategoryCard
              slug={story.slug}
              icon={story.icon}
              eyebrow={story.name}
              title={STORIES[story.slug]?.title ?? story.name}
              body={STORIES[story.slug]?.body ?? 'Hand-picked open source apps, straight from their developers.'}
              apps={byCategory.get(story.slug) ?? []}
            />
          ) : null}

          {indie ? <FeatureCard app={indie} eyebrow="Indie spotlight" /> : null}

          <ListCard
            eyebrow="New on ArkStore"
            title="Just landed"
            apps={newest.data ?? []}
            meta={(a) => `${compactNumber(a.stars)} stars on GitHub`}
          />
        </View>
      )}
    </LargeTitleScreen>
  );
}
