import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { DotRuleVertical } from '@/components/ui/dots';
import { Txt } from '@/components/ui/text';
import { space } from '@/theme';

export type Stat = { label: string; value: ReactNode; caption?: string };

/** The App Store info strip under the header: label, value, caption, dotted dividers. */
export function StatsStrip({ stats }: { stats: Stat[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.gutter }}>
      {stats.map((s, i) => (
        <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center' }}>
          {i > 0 ? <DotRuleVertical height={46} /> : null}
          <View style={{ minWidth: 96, paddingHorizontal: 14, alignItems: 'center', gap: 4 }}>
            <Txt variant="label" color="text3" numberOfLines={1}>
              {s.label}
            </Txt>
            {typeof s.value === 'string' ? (
              <Txt variant="number" numberOfLines={1}>
                {s.value}
              </Txt>
            ) : (
              <View style={{ height: 26, justifyContent: 'center' }}>{s.value}</View>
            )}
            {s.caption ? (
              <Txt variant="caption" color="text2" numberOfLines={1}>
                {s.caption}
              </Txt>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
