import { ScrollView, useWindowDimensions, View } from 'react-native';

import { DotRule } from '@/components/ui/dots';
import { RowSkeleton } from '@/components/ui/layout';
import type { ListApp } from '@/lib/types';
import { space } from '@/theme';

import { AppRow } from './app-row';

/** App Store shelf: columns of three rows that page sideways. */
export function Shelf({
  apps,
  loading,
  ranked,
  meta,
}: {
  apps: ListApp[] | undefined;
  loading?: boolean;
  ranked?: boolean;
  meta?: (app: ListApp) => string | undefined;
}) {
  const { width } = useWindowDimensions();
  const column = Math.min(width - space.gutter * 2 + 8, 420);
  if (loading || !apps) return <RowSkeleton count={3} />;

  const columns: ListApp[][] = [];
  for (let i = 0; i < apps.length; i += 3) columns.push(apps.slice(i, i + 3));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      snapToInterval={column}
      contentContainerStyle={{ paddingRight: space.gutter }}
    >
      {columns.map((col, ci) => (
        <View key={ci} style={{ width: column }}>
          {col.map((app, i) => (
            <View key={app.id}>
              <View style={{ marginLeft: -8 }}>
                <AppRow app={app} iconSize={56} rank={ranked ? ci * 3 + i + 1 : undefined} meta={meta?.(app)} />
              </View>
              {i < col.length - 1 ? <DotRule style={{ marginLeft: space.gutter + 62, width: column - space.gutter - 70 }} /> : null}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
