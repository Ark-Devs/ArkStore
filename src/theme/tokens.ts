// ArkStore design tokens: App Store layout, Nothing OS materials.
// Monochrome surfaces, true black on OLED, one red accent reserved for state
// (progress, badges, the active tab) and dot-matrix display type.

export const palette = {
  dark: {
    bg: '#000000',
    surface: '#111111',
    surface2: '#1B1B1B',
    surface3: '#262626',
    line: '#262626',
    text: '#F4F4F4',
    text2: '#9B9B9B',
    text3: '#646464',
    dot: '#2B2B2B',
    invert: '#F4F4F4',
    onInvert: '#000000',
    accent: '#E0242B',
    onAccent: '#FFFFFF',
    scrim: 'rgba(0,0,0,0.6)',
  },
  light: {
    bg: '#F1F1F1',
    surface: '#FFFFFF',
    surface2: '#E6E6E6',
    surface3: '#D9D9D9',
    line: '#DCDCDC',
    text: '#0C0C0C',
    text2: '#626262',
    text3: '#9C9C9C',
    dot: '#CFCFCF',
    invert: '#0C0C0C',
    onInvert: '#FFFFFF',
    accent: '#D71921',
    onAccent: '#FFFFFF',
    scrim: 'rgba(0,0,0,0.35)',
  },
} as const;

export type Palette = { [K in keyof (typeof palette)['dark']]: string };

export const fonts = {
  dot: 'Doto_800ExtraBold',
  dotBlack: 'Doto_900Black',
  sans: 'SpaceGrotesk_400Regular',
  sansMedium: 'SpaceGrotesk_500Medium',
  sansSemi: 'SpaceGrotesk_600SemiBold',
  sansBold: 'SpaceGrotesk_700Bold',
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold',
} as const;

// Shape rule: containers 22, app icons 22.5% of their size, everything tappable is a pill.
export const radius = { card: 22, tile: 16, input: 14, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, gutter: 20 } as const;

export const iconRadius = (size: number) => Math.round(size * 0.225);
