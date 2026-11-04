import { render, screen } from '@testing-library/react-native';

import ClosetScreen from '../../app/(tabs)/closet';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('@shopify/flash-list', () => require('../../test/flashListMock'));
// The frame callback runs on Reanimated's UI runtime, which jest-expo doesn't provide; its logic is
// covered by the pure functions in frameStats.test.ts.
jest.mock('../../perf/useFrameStats', () => ({
  useFrameStats: () => ({
    stats: { frames: 0, dropped: 0, droppedRatio: 0, p95Ms: 0, medianMs: 0 },
    reset: () => undefined,
  }),
}));

const originalUrl = process.env.EXPO_PUBLIC_PERF_FIXTURES_URL;

function setFixturesUrl(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.EXPO_PUBLIC_PERF_FIXTURES_URL;
  } else {
    process.env.EXPO_PUBLIC_PERF_FIXTURES_URL = value;
  }
}

afterEach(() => {
  setFixturesUrl(originalUrl);
});

type HostNode = { type: unknown; parent: HostNode | null };

function scrollViewAncestors(node: HostNode): number {
  let count = 0;
  for (let current = node.parent; current !== null; current = current.parent) {
    if (current.type === 'RCTScrollView') {
      count += 1;
    }
  }
  return count;
}

test('fixture mode: the grid owns scrolling, with the title as its header', async () => {
  setFixturesUrl('http://127.0.0.1:8787');
  await render(<ClosetScreen />);

  const list = screen.getByTestId('flash-list');
  // A vertical ScrollView around FlashList stretches it to full height and disables recycling.
  expect(scrollViewAncestors(list as unknown as HostNode)).toBe(0);
  expect(screen.getByRole('header', { name: 'YOUR CLOSET' })).toBeOnTheScreen();
  expect(scrollViewAncestors(screen.getByRole('header') as unknown as HostNode)).toBe(1);
  expect(screen.getByTestId('perf-hud')).toBeOnTheScreen();
});

test('fixture mode: shows the closet CTA from mockup 02, disabled', async () => {
  setFixturesUrl('http://127.0.0.1:8787');
  await render(<ClosetScreen />);

  expect(screen.getByRole('button', { name: 'Gallery' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Burst mode' })).toBeDisabled();
});

test.each([
  ['unset', undefined],
  ['empty', ''],
])('fixtures URL %s: the empty state, no HUD', async (_, value) => {
  setFixturesUrl(value);
  await render(<ClosetScreen />);

  expect(screen.getByText('Add your 10 favorites to get started.')).toBeOnTheScreen();
  expect(screen.getByText('YOUR CLOSET')).toBeOnTheScreen();
  expect(screen.queryByTestId('perf-hud')).not.toBeOnTheScreen();
  expect(screen.queryByTestId('flash-list')).not.toBeOnTheScreen();
});
