import { useColorScheme } from 'react-native';

import { usePrefs } from '@/lib/stores/prefs';

import { palette, type Palette } from './tokens';

export * from './tokens';

export function useScheme(): 'dark' | 'light' {
  const system = useColorScheme();
  const pref = usePrefs((s) => s.theme);
  if (pref !== 'system') return pref;
  return system === 'light' ? 'light' : 'dark';
}

export function useColors(): Palette {
  return palette[useScheme()];
}
