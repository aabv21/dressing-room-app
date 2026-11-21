// The bottom sheet slides up, or fades in with Reduce Motion on.
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { BottomSheet } from '../BottomSheet';

const mockMotion = { reduced: false };
jest.mock('react-native-reanimated', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import; see src/test/reanimatedMock.ts's module doc
  ...(require('../../test/reanimatedMock') as Record<string, unknown>),
  useReducedMotion: () => mockMotion.reduced,
}));

async function animationType(): Promise<unknown> {
  await render(
    <BottomSheet visible title="Title" onClose={jest.fn()} testID="sheet">
      <Text>Body</Text>
    </BottomSheet>,
  );
  return screen.getByTestId('sheet-modal').props.animationType;
}

test('slides up by default', async () => {
  mockMotion.reduced = false;
  expect(await animationType()).toBe('slide');
});

test('fades in with Reduce Motion on', async () => {
  mockMotion.reduced = true;
  expect(await animationType()).toBe('fade');
});
