import { router } from 'expo-router';
import { ArrowUpRight, MagnifyingGlass, XCircle } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { AppRow } from '@/components/store/app-row';
import { CategoryIcon } from '@/components/store/category-icon';
import { DotRule } from '@/components/ui/dots';
import { EmptyState, LargeTitleScreen, RowSkeleton, SectionHeader } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { useCategories, useSearch } from '@/lib/api';
import { compactNumber } from '@/lib/format';
import { friendlyError } from '@/lib/supabase';
import { fonts, radius, space, useColors } from '@/theme';

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function SearchScreen() {
  const c = useColors();
  const [query, setQuery] = useState('');
  const term = useDebounced(query.trim());
  const results = useSearch(term);
  const categories = useCategories();
  const searching = term.length >= 2;

  return (
    <LargeTitleScreen title="Search" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View
        style={{
          marginHorizontal: space.gutter,
          marginBottom: 20,
          height: 48,
          borderRadius: radius.input,
          backgroundColor: c.surface2,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 14,
          gap: 10,
        }}
      >
        <MagnifyingGlass size={20} color={c.text2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Apps, developers, repos"
          placeholderTextColor={c.text3}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search ArkStore"
          selectionColor={c.accent}
          style={{ flex: 1, color: c.text, fontFamily: fonts.sans, fontSize: 16, height: 48 }}
        />
        {query ? (
          <Tap onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <XCircle size={20} color={c.text3} weight="fill" />
          </Tap>
        ) : null}
      </View>

      {!searching ? (
        <>
          <SectionHeader title="Discover" />
          {(categories.data ?? []).map((cat, i) => (
            <View key={cat.slug}>
              {i > 0 ? <DotRule style={{ marginHorizontal: space.gutter }} /> : null}
              <Tap
                scale={0.99}
                onPress={() => router.push(`/category/${cat.slug}`)}
                accessibilityRole="link"
                accessibilityLabel={cat.name}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.gutter, height: 52 }}
              >
                <CategoryIcon name={cat.icon} size={20} color={c.text2} />
                <Txt variant="body" style={{ flex: 1 }}>
                  {cat.name}
                </Txt>
                <ArrowUpRight size={16} color={c.text3} />
              </Tap>
            </View>
          ))}
        </>
      ) : results.isLoading ? (
        <RowSkeleton count={5} />
      ) : results.error ? (
        <EmptyState glyph="!?" title="Search failed" body={friendlyError(results.error)} />
      ) : (results.data ?? []).length === 0 ? (
        <EmptyState glyph="?" title={`Nothing for "${term}"`} body="Try an app name, a developer or owner/repo." />
      ) : (
        <View style={{ gap: 4 }}>
          {results.data!.map((app) => (
            <AppRow key={app.id} app={app} meta={`${app.developer_login}  ·  ${compactNumber(app.stars)} stars`} />
          ))}
        </View>
      )}
    </LargeTitleScreen>
  );
}
