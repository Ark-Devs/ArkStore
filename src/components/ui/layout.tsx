import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, useReducedMotion } from 'react-native-reanimated';
import { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, useColors } from '@/theme';

import { DotRule } from './dots';
import { Tap } from './tap';
import { Txt } from './text';

/** Scrolling tab screen with an App Store style large title set in dot-matrix type. */
export function LargeTitleScreen({
  title,
  eyebrow,
  accessory,
  children,
  refreshing,
  onRefresh,
  contentStyle,
  ...scroll
}: ScrollViewProps & {
  title: string;
  eyebrow?: string;
  accessory?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      {...scroll}
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[{ paddingTop: insets.top + 14, paddingBottom: 120 }, contentStyle]}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={c.text} colors={[c.accent]} progressBackgroundColor={c.surface} />
        ) : undefined
      }
    >
      <View style={{ paddingHorizontal: space.gutter, flexDirection: 'row', alignItems: 'flex-end', marginBottom: 18 }}>
        <View style={{ flex: 1 }}>
          {eyebrow ? (
            <Txt variant="label" color="text2" style={{ marginBottom: 6 }}>
              {eyebrow}
            </Txt>
          ) : null}
          <Txt variant="hero" accessibilityRole="header">
            {title}
          </Txt>
        </View>
        {accessory}
      </View>
      {children}
    </ScrollView>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ paddingHorizontal: space.gutter, marginBottom: 12, marginTop: 8 }}>
      <DotRule style={{ marginBottom: 14 }} />
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Txt variant="section" accessibilityRole="header">
          {title}
        </Txt>
        {action && onAction ? (
          <Tap onPress={onAction} hitSlop={10} accessibilityRole="link">
            <Txt variant="label" color="text2">
              {action}
            </Txt>
          </Tap>
        ) : null}
      </View>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ backgroundColor: c.surface, borderRadius: radius.card, overflow: 'hidden' }, style]}>{children}</View>
  );
}

/** Pulsing placeholder block shaped like the content it stands in for. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const o = useSharedValue(0.5);
  useEffect(() => {
    if (!reduce) o.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [o, reduce]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ backgroundColor: c.surface2, borderRadius: 10 }, anim, style]} />;
}

export function RowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ paddingHorizontal: space.gutter, gap: 18 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Skeleton style={{ width: 60, height: 60, borderRadius: 14 }} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton style={{ width: '55%', height: 14 }} />
            <Skeleton style={{ width: '80%', height: 12 }} />
          </View>
          <Skeleton style={{ width: 66, height: 30, borderRadius: 15 }} />
        </View>
      ))}
    </View>
  );
}

/** Empty and error states: a dot-matrix glyph, one line of copy, one action. */
export function EmptyState({
  glyph,
  title,
  body,
  action,
}: {
  glyph: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 36, paddingVertical: 40, gap: 10 }}>
      <Txt variant="hero" size={56} color="text3" accessibilityElementsHidden>
        {glyph}
      </Txt>
      <Txt variant="headline" align="center">
        {title}
      </Txt>
      {body ? (
        <Txt variant="callout" color="text2" align="center">
          {body}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: ReactNode;
}) {
  const c = useColors();
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        height: 36,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? c.invert : c.line,
        backgroundColor: active ? c.invert : 'transparent',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {icon}
      <Txt variant="subhead" color={active ? 'onInvert' : 'text'}>
        {label}
      </Txt>
    </Tap>
  );
}
