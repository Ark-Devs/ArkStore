// Nothing OS materials: dot grids, dotted rules and a dot-matrix loader.
import { useEffect, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
import Svg, { Circle, Defs, Line, Pattern, Rect } from 'react-native-svg';

import { useColors } from '@/theme';

/** Fills its parent with an even dot grid. */
export function DotGrid({
  gap = 12,
  size = 1.4,
  color,
  style,
}: {
  gap?: number;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const id = `dots${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} width={gap} height={gap} patternUnits="userSpaceOnUse">
            <Circle cx={gap / 2} cy={gap / 2} r={size} fill={color ?? c.dot} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** A dotted horizontal rule. */
export function DotRule({ style, color }: { style?: StyleProp<ViewStyle>; color?: string }) {
  const c = useColors();
  return (
    <View style={[{ height: 4, width: '100%' }, style]}>
      <Svg width="100%" height={4}>
        <Line
          x1={2}
          y1={2}
          x2="100%"
          y2={2}
          stroke={color ?? c.surface3}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="0.1 6"
        />
      </Svg>
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
