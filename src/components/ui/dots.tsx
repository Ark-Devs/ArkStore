// Nothing OS materials: dot grids, dotted rules and a dot-matrix loader.
// Grids and rules are tiny white PNG tiles (scripts/make-icons.ts) repeated by the image
// view and tinted per theme. Live SVG patterns looked the same but Android redrew them
// on every scroll frame.
import { useEffect } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';

import { useColors } from '@/theme';

const GRID_12 = require('@/assets/images/dots/dot-grid-12.png');
const GRID_8 = require('@/assets/images/dots/dot-grid-8.png');
const RULE = require('@/assets/images/dots/dot-rule.png');
const RULE_V = require('@/assets/images/dots/dot-rule-v.png');

const fill = { width: '100%', height: '100%' } as const;

/** Fills its parent with an even dot grid. `gap` under 10 uses the fine grid. */
export function DotGrid({
  gap = 12,
  color,
  style,
}: {
  gap?: number;
  /** Kept for call-site compatibility; dot size comes from the tile. */
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]}>
      <Image
        source={gap < 10 ? GRID_8 : GRID_12}
        resizeMode="repeat"
        fadeDuration={0}
        style={[fill, { tintColor: color ?? c.dot }]}
      />
    </View>
  );
}

/** A dotted horizontal rule. */
export function DotRule({ style, color }: { style?: StyleProp<ViewStyle>; color?: string }) {
  const c = useColors();
  return (
    <View pointerEvents="none" style={[{ height: 4, width: '100%', overflow: 'hidden' }, style]}>
      <Image source={RULE} resizeMode="repeat" fadeDuration={0} style={[fill, { tintColor: color ?? c.surface3 }]} />
    </View>
  );
}

/** A dotted vertical rule, e.g. between stats. */
export function DotRuleVertical({ height, color }: { height: number; color?: string }) {
  const c = useColors();
  return (
    <View pointerEvents="none" style={{ width: 4, height, overflow: 'hidden' }}>
      <Image source={RULE_V} resizeMode="repeat" fadeDuration={0} style={[fill, { tintColor: color ?? c.surface3 }]} />
    </View>
  );
}

function LoaderDot({ index, color, size }: { index: number; color: string; size: number }) {
  const reduce = useReducedMotion();
  const o = useSharedValue(reduce ? 0.6 : 0.15);
  useEffect(() => {
    if (reduce) return;
    // Diagonal wave across the 3x3 matrix.
    const delay = ((index % 3) + Math.floor(index / 3)) * 110;
    o.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) }),
          withTiming(0.15, { duration: 520, easing: Easing.in(Easing.quad) }),
        ),
        -1,
      ),
    );
  }, [index, o, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
    />
  );
}

/** 3x3 dot-matrix loader in place of a spinner. */
export function DotLoader({ size = 5, color }: { size?: number; color?: string }) {
  const c = useColors();
  const gap = size * 0.8;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={{ width: size * 3 + gap * 2, flexDirection: 'row', flexWrap: 'wrap', gap }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <LoaderDot key={i} index={i} size={size} color={color ?? c.text} />
      ))}
    </View>
  );
}
