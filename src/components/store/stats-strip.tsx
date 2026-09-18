import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { Txt } from '@/components/ui/text';
import { space, useColors } from '@/theme';

export type Stat = { label: string; value: ReactNode; caption?: string };

function VerticalDots() {
  const c = useColors();
  return (
    <Svg width={2} height={46}>
      <Line x1={1} y1={1} x2={1} y2={46} stroke={c.surface3} strokeWidth={2} strokeLinecap="round" strokeDasharray="0.1 5" />
    </Svg>
  );
}

/** The App Store info strip under the header, with dot-matrix values. */
export function StatsStrip({ stats }: { stats: Stat[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.gutter }}>
      {stats.map((s, i) => (
        <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center' }}>
          {i > 0 ? <VerticalDots /> : null}
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
