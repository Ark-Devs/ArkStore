import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, useColors } from '@/theme';

import { DotLoader } from './dots';
import { Tap } from './tap';
import { Txt } from './text';

type Variant = 'primary' | 'secondary' | 'accent' | 'ghost';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

const HEIGHT = { sm: 32, md: 44, lg: 54 } as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  full,
  style,
  accessibilityLabel,
}: Props) {
  const c = useColors();
  const bg = { primary: c.invert, secondary: c.surface2, accent: c.accent, ghost: 'transparent' }[variant];
  const fg = { primary: 'onInvert', secondary: 'text', accent: 'onAccent', ghost: 'text' }[variant] as
    | 'onInvert'
    | 'text'
    | 'onAccent';

  return (
    <Tap
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        {
          height: HEIGHT[size],
          paddingHorizontal: size === 'sm' ? 16 : 22,
          borderRadius: radius.pill,
          backgroundColor: bg,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: c.line,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          alignSelf: full ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <DotLoader size={3.5} color={c[fg]} />
      ) : (
        <>
          {icon ? <View>{icon}</View> : null}
          <Txt
            variant={size === 'sm' ? 'label' : 'headline'}
            color={fg}
            numberOfLines={1}
            style={size === 'sm' ? { fontSize: 12, letterSpacing: 1.2 } : null}
          >
            {label}
          </Txt>
        </>
      )}
    </Tap>
  );
}
