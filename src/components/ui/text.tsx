import { Text, type TextProps, type TextStyle } from 'react-native';

import { fonts, useColors, type Palette } from '@/theme';

const VARIANTS = {
  // Dot-matrix display type (Nothing OS).
  hero: { fontFamily: fonts.dot, fontSize: 44, lineHeight: 48, letterSpacing: -0.5 },
  display: { fontFamily: fonts.dot, fontSize: 34, lineHeight: 38 },
  // Stats and counts: clean grotesk with even-width digits so values line up.
  number: { fontFamily: fonts.sansBold, fontSize: 21, lineHeight: 26, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  // Interface type.
  title: { fontFamily: fonts.sansBold, fontSize: 24, lineHeight: 29, letterSpacing: -0.3 },
  section: { fontFamily: fonts.sansBold, fontSize: 20, lineHeight: 25, letterSpacing: -0.2 },
  headline: { fontFamily: fonts.sansSemi, fontSize: 16, lineHeight: 21 },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
  callout: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 19 },
  subhead: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 17 },
  caption: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16 },
  // Mono labels: small caps meta, like Nothing's system labels.
  label: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 14, letterSpacing: 1.4, textTransform: 'uppercase' },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16 },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof VARIANTS;

type Props = TextProps & {
  variant?: TextVariant;
  color?: keyof Palette;
  size?: number;
  align?: TextStyle['textAlign'];
};

export function Txt({ variant = 'body', color = 'text', size, align, style, ...rest }: Props) {
  const c = useColors();
  const base = VARIANTS[variant];
  return (
    <Text
      {...rest}
      style={[
        base,
        { color: c[color] },
        size ? { fontSize: size, lineHeight: Math.round(size * (base.lineHeight / base.fontSize)) } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
