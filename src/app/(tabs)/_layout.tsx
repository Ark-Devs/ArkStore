import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { UpdateBanner } from '@/components/store/update-banner';
import { TabBar, useSideBar } from '@/components/tab-bar';

export default function TabsLayout() {
  const side = useSideBar();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false, tabBarPosition: side ? 'left' : 'bottom' }}
        tabBar={(props) => <TabBar {...props} />}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="apps" />
        <Tabs.Screen name="updates" />
        <Tabs.Screen name="search" />
        <Tabs.Screen name="studio" />
      </Tabs>
      {/* Wide windows: ArkStore's own update, bottom-right over every tab. */}
      {side ? <UpdateBanner style={{ position: 'absolute', right: 24, bottom: 24, width: 420, maxWidth: '90%' }} /> : null}
    </View>
  );
}
