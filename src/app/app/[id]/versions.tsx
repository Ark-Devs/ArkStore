import { useLocalSearchParams } from 'expo-router';
import { FlatList, View } from 'react-native';

import { DotRule } from '@/components/ui/dots';
import { EmptyState, RowSkeleton } from '@/components/ui/layout';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useApp, useVersions } from '@/lib/api';
import { fileSize, longDate, plainNotes } from '@/lib/format';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

export default function VersionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const app = useApp(id);
  const versions = useVersions(id);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar title={app.data ? `${app.data.name} versions` : 'Version history'} />
      {versions.isLoading ? (
        <View style={{ paddingTop: 20 }}>
          <RowSkeleton count={4} />
        </View>
      ) : versions.error ? (
        <EmptyState glyph="!?" title="Couldn't load versions" body={friendlyError(versions.error)} />
      ) : (
        <FlatList
          data={versions.data ?? []}
          keyExtractor={(v) => String(v.id)}
          contentContainerStyle={{ padding: space.gutter, paddingBottom: 60 }}
          ItemSeparatorComponent={() => <DotRule style={{ marginVertical: 18 }} />}
          ListEmptyComponent={<EmptyState glyph="0" title="No versions yet" />}
          renderItem={({ item, index }) => (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Txt variant="number" size={20} style={{ flexShrink: 1 }} numberOfLines={1}>
                  {item.version}
                </Txt>
                {index === 0 ? (
                  <View style={{ paddingHorizontal: 8, height: 20, borderRadius: radius.pill, backgroundColor: c.accent, justifyContent: 'center' }}>
                    <Txt variant="label" color="onAccent" style={{ fontSize: 9 }}>
                      Latest
                    </Txt>
                  </View>
                ) : null}
                {item.prerelease ? (
                  <Txt variant="label" color="text3" style={{ fontSize: 9 }}>
                    Beta
                  </Txt>
                ) : null}
              </View>
              <Txt variant="mono" color="text3" style={{ fontSize: 11 }}>
                {longDate(item.published_at)}  ·  {fileSize(item.apk_size)}
              </Txt>
              <Txt variant="callout" color="text2">
                {plainNotes(item.notes) || 'No release notes.'}
              </Txt>
            </View>
          )}
        />
      )}
    </View>
  );
}
