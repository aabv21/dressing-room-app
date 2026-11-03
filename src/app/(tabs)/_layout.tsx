import { Tabs } from 'expo-router';

import { GlassTabBar } from '../../ui/GlassTabBar';
import { TABS } from '../../ui/layout';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <GlassTabBar {...props} />} screenOptions={{ headerShown: false }}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.route} name={tab.route} />
      ))}
    </Tabs>
  );
}
