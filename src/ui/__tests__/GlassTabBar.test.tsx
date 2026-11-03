import { fireEvent, render, screen } from '@testing-library/react-native';
import type { BottomTabBarProps } from 'expo-router/tabs';

import { GlassTabBar } from '../GlassTabBar';

const routes = ['index', 'closet', 'build', 'for-you', 'profile'].map((name) => ({ key: name, name }));

// NOTE: expo-router 58's actual BottomTabBarProps passes `emitter`/`navigateToTab`, not the
// classic React Navigation `navigation.{emit,navigate}` pair — verified against the installed
// package's runtime (expo-router/build/react-navigation/bottom-tabs/views/BottomTabView.js).
test('five tabs in mockup order, the active one selected, press navigates', async () => {
  const navigateToTab = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  await render(
    <GlassTabBar
      {...({
        state: { index: 1, routes },
        emitter: { emit },
        navigateToTab,
        descriptors: {},
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      } as unknown as BottomTabBarProps)}
    />,
  );
  expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel as string)).toEqual([
    'Today',
    'Closet',
    'Build',
    'For you',
    'Profile',
  ]);
  expect(screen.getByRole('tab', { name: 'Closet' })).toBeSelected();
  await fireEvent.press(screen.getByRole('tab', { name: 'Build' }));
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'tabPress', target: 'build' }));
  expect(navigateToTab).toHaveBeenCalledWith('build');
});

test('pressing the focused tab does not navigate', async () => {
  const navigateToTab = jest.fn();
  await render(
    <GlassTabBar
      {...({
        state: { index: 0, routes },
        emitter: { emit: () => ({ defaultPrevented: false }) },
        navigateToTab,
        descriptors: {},
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      } as unknown as BottomTabBarProps)}
    />,
  );
  await fireEvent.press(screen.getByRole('tab', { name: 'Today' }));
  expect(navigateToTab).not.toHaveBeenCalled();
});
