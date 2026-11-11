import { render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet, Text } from 'react-native';

import { Screen } from '../Screen';

// A notch: 47 pt of status bar.
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock()'s factory can only reference globals (incl. `require`)
  const actual = (require('react-native-safe-area-context/jest/mock') as { default: Record<string, unknown> }).default;
  return { ...actual, useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }) };
});

const originalOs = Platform.OS;

afterEach(() => {
  Platform.OS = originalOs;
});

test.each([
  ['ios', 'interactive'],
  ['android', 'on-drag'],
] as const)('on %s the content scrolls clear of the keyboard and a drag dismisses it', async (os, dismissMode) => {
  Platform.OS = os;
  await render(
    <Screen title="Your body" chrome="none">
      <Text>Hips</Text>
    </Screen>,
  );

  const scroll = screen.getByTestId('screen-scroll');
  // iOS insets the scroll view by the keyboard, so the last fields can scroll above it; a number
  // pad has no return key, so dragging the content is how the keyboard goes away.
  expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
  expect(scroll.props.keyboardDismissMode).toBe(dismissMode);
});

test('a status-bar scrim of insets.top height sits above scrolled content', async () => {
  await render(
    <Screen title="Profile">
      <Text>Body</Text>
    </Screen>,
  );

  const scrim = screen.getByTestId('status-scrim');
  expect(StyleSheet.flatten(scrim.props.style)).toMatchObject({ position: 'absolute', top: 0, height: 47 });
  expect(scrim.props.pointerEvents).toBe('none');
});

test('Screen with chrome none and a cta renders the backdrop', async () => {
  await render(
    <Screen title="Your body" chrome="none" cta={{ primary: { label: 'Next', tone: 'commit', onPress: jest.fn() } }}>
      <Text>Hips</Text>
    </Screen>,
  );
  expect(screen.getByTestId('cta-backdrop')).toBeOnTheScreen();

  await render(
    <Screen title="Today" cta={{ primary: { label: 'Wear', tone: 'commit', onPress: jest.fn() } }}>
      <Text>Outfit</Text>
    </Screen>,
  );
  expect(screen.queryByTestId('cta-backdrop')).toBeNull();
});
