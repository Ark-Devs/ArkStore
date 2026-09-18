import { router } from 'expo-router';
import { CaretLeft, ShareNetwork, X } from 'phosphor-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/theme';

import { Tap } from './tap';
import { Txt } from './text';

/** Floating round back/close button, optional title and trailing action. */
export function TopBar({
  onShare,
  title,
  close,
  trailing,
}: {
  onShare?: () => void;
  title?: string;
  close?: boolean;
  trailing?: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const round = {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  } as const;
  const Back = close ? X : CaretLeft;
  return (
    <View
      style={{
        paddingTop: insets.top + 6,
        paddingHorizontal: 14,
        paddingBottom: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: c.bg,
      }}
    >
      <Tap
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={round}
        accessibilityRole="button"
        accessibilityLabel={close ? 'Close' : 'Back'}
      >
        <Back size={20} color={c.text} />
      </Tap>
      <View style={{ flex: 1 }}>
        {title ? (
          <Txt variant="headline" numberOfLines={1}>
            {title}
          </Txt>
        ) : null}
      </View>
      {trailing}
      {onShare ? (
        <Tap onPress={onShare} style={round} accessibilityRole="button" accessibilityLabel="Share">
          <ShareNetwork size={18} color={c.text} />
        </Tap>
      ) : null}
    </View>
  );
}
