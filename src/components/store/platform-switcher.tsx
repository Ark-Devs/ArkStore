import { AndroidLogo } from 'phosphor-react-native/src/icons/AndroidLogo';
import { AppleLogo } from 'phosphor-react-native/src/icons/AppleLogo';
import { Globe } from 'phosphor-react-native/src/icons/Globe';
import { LinuxLogo } from 'phosphor-react-native/src/icons/LinuxLogo';
import { WindowsLogo } from 'phosphor-react-native/src/icons/WindowsLogo';
import type { Icon } from 'phosphor-react-native';
import { ScrollView } from 'react-native';

import { Chip } from '@/components/ui/layout';
import { catalogOS } from '@/lib/platform';
import { useBrowse, type BrowseOS } from '@/lib/stores/browse';
import { space, useColors } from '@/theme';

const OPTIONS: { os: BrowseOS; label: string; icon: Icon }[] = [
  { os: 'windows', label: 'Windows', icon: WindowsLogo },
  { os: 'macos', label: 'macOS', icon: AppleLogo },
  { os: 'linux', label: 'Linux', icon: LinuxLogo },
  { os: 'android', label: 'Android', icon: AndroidLogo },
  { os: 'all', label: 'All platforms', icon: Globe },
];

/**
 * Which platform's apps to browse. This device's platform comes first and is picked by
 * default; the others are one tap away.
 */
export function PlatformSwitcher() {
  const c = useColors();
  const os = useBrowse((s) => s.os);
  const setOS = useBrowse((s) => s.setOS);
  const mine = catalogOS();
  const options = mine ? [...OPTIONS].sort((a, b) => Number(b.os === mine) - Number(a.os === mine)) : OPTIONS;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: space.gutter, paddingBottom: 18 }}
      accessibilityRole="radiogroup"
      accessibilityLabel="Show apps for"
    >
      {options.map((o) => {
        const active = os === o.os;
        return (
          <Chip
            key={o.os}
            label={o.os === mine ? `${o.label} · this device` : o.label}
            active={active}
            onPress={() => setOS(o.os)}
            icon={<o.icon size={15} color={active ? c.onInvert : c.text} weight={active ? 'fill' : 'regular'} />}
          />
        );
      })}
    </ScrollView>
  );
}
