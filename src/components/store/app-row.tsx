import { router } from 'expo-router';
import { View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import type { ListApp } from '@/lib/types';
import { space } from '@/theme';

import { GetButton } from './get-button';

export function AppRow({
  app,
  rank,
  meta,
  iconSize = 60,
  showButton = true,
}: {
  app: ListApp;
  rank?: number;
  meta?: string;
  iconSize?: number;
  showButton?: boolean;
}) {
  return (
    <Tap
      scale={0.98}
      onPress={() => router.push(`/app/${app.id}`)}
      accessibilityRole="link"
      accessibilityLabel={`${app.name}. ${app.subtitle}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.gutter, paddingVertical: 8 }}
    >
      <AppIcon uri={app.icon_url} name={app.name} size={iconSize} />
      {rank ? (
        <Txt variant="number" size={18} style={{ width: 22, textAlign: 'center' }}>
          {rank}
        </Txt>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {app.name}
          </Txt>
          {app.featured ? (
            <Txt variant="label" color="accent" style={{ fontSize: 8.5 }}>
              Featured
            </Txt>
          ) : null}
        </View>
        <Txt variant="callout" color="text2" numberOfLines={meta ? 1 : 2}>
          {app.subtitle || app.developer_login}
        </Txt>
        {meta ? (
          <Txt variant="mono" color="text3" numberOfLines={1} style={{ marginTop: 2, fontSize: 11 }}>
            {meta}
          </Txt>
        ) : null}
      </View>
      {showButton ? <GetButton app={app} /> : null}
    </Tap>
  );
}
