import { Tabs, router } from 'expo-router';
import { useEffect } from 'react';

import { GlassTabBar } from '../../ui/GlassTabBar';
import { TABS } from '../../ui/layout';
import { useOnboardingArrival } from '../../ui/onboardingArrival';

export default function TabsLayout() {
  const arrival = useOnboardingArrival();
  useEffect(() => {
    if (arrival.pending) {
      arrival.settle();
      router.replace('/closet');
    }
  }, [arrival]);

  return (
    <Tabs tabBar={(props) => <GlassTabBar {...props} />} screenOptions={{ headerShown: false }}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.route} name={tab.route} />
      ))}
    </Tabs>
  );
}
