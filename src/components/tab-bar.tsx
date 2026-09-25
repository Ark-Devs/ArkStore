import type { Tabs } from 'expo-router';
import { ArrowsClockwise } from 'phosphor-react-native/src/icons/ArrowsClockwise';
import { Code } from 'phosphor-react-native/src/icons/Code';
import { MagnifyingGlass } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { Newspaper } from 'phosphor-react-native/src/icons/Newspaper';
import { SquaresFour } from 'phosphor-react-native/src/icons/SquaresFour';
import type { Icon } from 'phosphor-react-native';
import { Platform, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { useInstalled } from '@/lib/stores/installed';
import { useColors } from '@/theme';

type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const TABS: Record<string, { label: string; icon: Icon }> = {
  index: { label: 'Today', icon: Newspaper },
  apps: { label: 'Apps', icon: SquaresFour },
  updates: { label: 'Updates', icon: ArrowsClockwise },
  search: { label: 'Search', icon: MagnifyingGlass },
  studio: { label: 'Studio', icon: Code },
};

/** Wide windows (the desktop app, a browser on a computer) get a sidebar instead of a bottom bar. */
export function useSideBar() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 900;
}

/** Nothing-style bar: thin glyphs, mono labels, a red dot over the active tab. */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const updateCount = useInstalled((s) => Object.keys(s.updates).length);
  const side = useSideBar();

  return (
    <View
      style={
        side
          ? {
              width: 92,
              flexDirection: 'column',
              backgroundColor: c.bg,
              borderRightWidth: 1,
              borderRightColor: c.line,
              paddingTop: insets.top + 24,
              gap: 18,
            }
          : {
              flexDirection: 'row',
              backgroundColor: c.bg,
              borderTopWidth: 1,
              borderTopColor: c.line,
              paddingBottom: Math.max(insets.bottom, 10),
              paddingTop: 6,
            }
      }
    >
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = state.index === index;
        const Glyph = tab.icon;
        const badge = route.name === 'updates' && updateCount > 0 ? updateCount : 0;
        return (
          <Tap
            key={route.key}
            scale={0.92}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={badge ? `${tab.label}, ${badge} available` : tab.label}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            }}
            style={side ? { alignItems: 'center', gap: 3, paddingVertical: 6 } : { flex: 1, alignItems: 'center', gap: 3, paddingTop: 4 }}
          >
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: focused ? c.accent : 'transparent', marginBottom: 2 }} />
            <View>
              <Glyph size={24} color={focused ? c.text : c.text3} weight={focused ? 'regular' : 'light'} />
              {badge ? (
                <View
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -10,
                    minWidth: 17,
                    height: 17,
                    borderRadius: 9,
                    paddingHorizontal: 4,
                    backgroundColor: c.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Txt variant="label" color="onAccent" style={{ fontSize: 9.5, letterSpacing: 0, fontFamily: 'SpaceMono_700Bold' }}>
                    {badge > 9 ? '9+' : badge}
                  </Txt>
                </View>
              ) : null}
            </View>
            <Txt variant="label" color={focused ? 'text' : 'text3'} style={{ fontSize: 9 }}>
              {tab.label}
            </Txt>
          </Tap>
        );
      })}
    </View>
  );
}
