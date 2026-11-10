import { render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';

import { Screen } from '../Screen';

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
