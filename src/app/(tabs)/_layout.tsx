import { Tabs } from 'expo-router';

import { TabBar, useSideBar } from '@/components/tab-bar';

export default function TabsLayout() {
  const side = useSideBar();
  return (
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
  );
}
