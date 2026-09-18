import { Tabs } from 'expo-router';

import { TabBar } from '@/components/tab-bar';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="apps" />
      <Tabs.Screen name="updates" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="studio" />
    </Tabs>
  );
}
