import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import ClosetScreen from '../../app/(tabs)/closet';
import { garment } from '../../test/garmentFixture';
import type { Garment } from '../garmentRepository';
import { usePendingPolling } from '../ClosetProvider';

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
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useIsFocused: jest.fn(() => true),
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));
// The Stats segment's seams; its own suite is src/__tests__/closet-stats.test.tsx.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('react-native-reanimated', () => require('../../test/reanimatedMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- same as above
jest.mock('../../outfits/aiClient', () => require('../../test/outfitClientsMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- same as above
jest.mock('../../stats/wearsRepository', () => require('../../test/statsClientsMock'));
// The Diary segment reads the signed-in user (its deletes clear Today's worn record).
jest.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));
jest.mock('../garmentRepository', () => ({ updateGarment: jest.fn() }));

type ClosetState = {
  garments: Garment[];
  thumbUrls: Map<string, string>;
  status: 'loading' | 'ready' | 'offline';
};
type QueueState = { pending: number; failed: number };

const mockCloset: { current: ClosetState } = {
  current: { garments: [], thumbUrls: new Map(), status: 'ready' },
};
const mockQueue: { current: QueueState } = { current: { pending: 0, failed: 0 } };
const mockQueueActions = {
  enqueue: jest.fn(),
  enqueueReplacement: jest.fn(),
  retryFailed: jest.fn(),
  discardFailed: jest.fn(),
};

jest.mock('../ClosetProvider', () => ({
  useCloset: () => ({
    ...mockCloset.current,
    refresh: () => Promise.resolve(),
    replaceLocal: () => undefined,
    removeLocal: () => undefined,
  }),
  usePendingPolling: jest.fn(),
}));
jest.mock('../UploadQueueProvider', () => ({
  useUploadQueue: () => ({ ...mockQueue.current, ...mockQueueActions }),
}));

const originalUrl = process.env.EXPO_PUBLIC_PERF_FIXTURES_URL;

function setFixturesUrl(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.EXPO_PUBLIC_PERF_FIXTURES_URL;
  } else {
    process.env.EXPO_PUBLIC_PERF_FIXTURES_URL = value;
  }
}

const reviewedAt = '2026-11-08T12:05:00.000Z';

/** Reviewed garments by category, so no review banner unless a test asks for one. */
function closetOf(categories: readonly NonNullable<Garment['category']>[]): Garment[] {
  return categories.map((category, index) =>
    garment({ id: `g-${String(index)}`, category, extraction_status: 'done', reviewed_at: reviewedAt }),
  );
}

const SEVEN: readonly NonNullable<Garment['category']>[] = [
  't_shirt',
  'blouse',
  'sweater',
  'jeans',
  'skirt',
  'sneakers',
  'heels',
];

function setCloset(garments: Garment[], status: ClosetState['status'] = 'ready'): void {
  mockCloset.current = { garments, thumbUrls: new Map(), status };
}

beforeEach(() => {
  jest.clearAllMocks();
  setFixturesUrl(undefined);
  setCloset([]);
  mockQueue.current = { pending: 0, failed: 0 };
});

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

describe('fixture mode', () => {
  test('the grid owns scrolling, with the title as its header', async () => {
    setFixturesUrl('http://127.0.0.1:8787');
    await render(<ClosetScreen />);

    const list = screen.getByTestId('flash-list');
    // A vertical ScrollView around FlashList stretches it to full height and disables recycling.
    expect(scrollViewAncestors(list as unknown as HostNode)).toBe(0);
    expect(screen.getByRole('header', { name: 'YOUR CLOSET' })).toBeOnTheScreen();
    expect(scrollViewAncestors(screen.getByRole('header') as unknown as HostNode)).toBe(1);
    expect(screen.getByTestId('perf-hud')).toBeOnTheScreen();
  });

  test('shows the closet CTA from mockup 02, disabled', async () => {
    setFixturesUrl('http://127.0.0.1:8787');
    await render(<ClosetScreen />);

    expect(screen.getByRole('button', { name: 'Gallery' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Burst mode' })).toBeDisabled();
  });
});

describe('real mode', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
  ])('fixtures URL %s: an empty closet shows the goal at 0/10 and the empty state, no HUD', async (_, value) => {
    setFixturesUrl(value);
    await render(<ClosetScreen />);

    expect(screen.getByText('YOUR CLOSET')).toBeOnTheScreen();
    expect(screen.getByText('Your 10 favorites')).toBeOnTheScreen();
    expect(screen.getByText('0/10')).toBeOnTheScreen();
    expect(screen.getByText('Add your 10 favorites to get started.')).toBeOnTheScreen();
    expect(screen.queryByTestId('perf-hud')).not.toBeOnTheScreen();
    expect(screen.queryByRole('radio')).not.toBeOnTheScreen();
  });

  test('with 7 garments: the goal reads 7/10 and the chips count all and each slot', async () => {
    setCloset(closetOf(SEVEN));
    await render(<ClosetScreen />);

    expect(screen.getByText('7/10')).toBeOnTheScreen();
    expect(screen.getByText('With 10 pieces I can already put outfits together. Add the rest whenever you like.')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ min: 0, max: 10, now: 7 });
    expect(screen.getByRole('radio', { name: 'All 7' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Tops 3' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Bottoms 2' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Shoes 2' })).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: /Outerwear/ })).not.toBeOnTheScreen();
    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(7);
  });

  test('picking a slot chip filters the grid, and "All" brings everything back', async () => {
    setCloset(closetOf(SEVEN));
    await render(<ClosetScreen />);

    await fireEvent.press(screen.getByRole('radio', { name: 'Bottoms 2' }));
    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Bottoms 2' })).toBeChecked();

    await fireEvent.press(screen.getByRole('radio', { name: 'All 7' }));
    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(7);
  });

  test('a category chip row appears under the slot chips and filters the grid', async () => {
    setCloset(closetOf(SEVEN));
    await render(<ClosetScreen />);

    await fireEvent.press(screen.getByRole('radio', { name: 'Tops 3' }));
    const categories = screen.getByLabelText('Filter by category');
    expect(within(categories).getAllByRole('radio').map((chip) => chip.props.accessibilityLabel as string)).toEqual([
      'All',
      'T-shirt',
      'Blouse',
      'Sweater',
    ]);

    await fireEvent.press(within(categories).getByRole('radio', { name: 'Blouse' }));
    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(1);
    expect(screen.getByTestId('grid-cell-g-1')).toBeOnTheScreen();
  });

  test('changing the slot resets the category', async () => {
    setCloset(closetOf(SEVEN));
    await render(<ClosetScreen />);

    await fireEvent.press(screen.getByRole('radio', { name: 'Tops 3' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Blouse' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Bottoms 2' }));

    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
  });

  test('a category that empties falls back to all', async () => {
    setCloset(closetOf(SEVEN));
    const view = await render(<ClosetScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Tops 3' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Blouse' }));

    setCloset(closetOf(SEVEN).filter((g) => g.category !== 'blouse'));
    await view.rerender(<ClosetScreen />);

    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
  });

  test('while the closet loads, a labeled spinner shows instead of the empty state', async () => {
    setCloset([], 'loading');
    await render(<ClosetScreen />);

    expect(screen.getByLabelText('Loading your closet')).toBeOnTheScreen();
    expect(screen.queryByText('0/10')).toBeNull();
  });

  test('with 10 garments the goal card is gone', async () => {
    setCloset(closetOf([...SEVEN, 'coat', 'dress', 'hat']));
    await render(<ClosetScreen />);

    expect(screen.queryByText('Your 10 favorites')).not.toBeOnTheScreen();
    expect(screen.queryByText('10/10')).not.toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'All 10' })).toBeOnTheScreen();
  });

  test('3 pending uploads show the processing tile first', async () => {
    setCloset(closetOf(SEVEN));
    mockQueue.current = { pending: 3, failed: 0 };
    await render(<ClosetScreen />);

    expect(screen.getByText('Processing 3 photos…')).toBeOnTheScreen();
    expect(screen.getByTestId('grid-leading-tile')).toBeOnTheScreen();
  });

  test('failed uploads show a tile whose alert offers retry or discard', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockQueue.current = { pending: 0, failed: 2 };
    await render(<ClosetScreen />);

    await fireEvent.press(screen.getByRole('button', { name: "2 photos didn't upload" }));

    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    expect(buttons.map((button) => button.text)).toEqual(['Cancel', 'Discard', 'Try again']);
    buttons.find((button) => button.text === 'Try again')?.onPress?.();
    expect(mockQueueActions.retryFailed).toHaveBeenCalledTimes(1);
    buttons.find((button) => button.text === 'Discard')?.onPress?.();
    expect(mockQueueActions.discardFailed).toHaveBeenCalledTimes(1);
  });

  test('a review queue of 2 shows the banner, and tapping it opens review', async () => {
    setCloset([
      ...closetOf(SEVEN.slice(0, 3)),
      garment({ id: 'r-1', extraction_status: 'failed', created_at: '2026-11-08T11:00:00.000Z' }),
      garment({ id: 'r-2', extraction_status: 'done', category: 'jeans', created_at: '2026-11-08T11:01:00.000Z' }),
    ]);
    await render(<ClosetScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '2 garments to review' }));

    expect(router.push).toHaveBeenCalledWith('/review');
  });

  test('no review banner when nothing awaits review', async () => {
    setCloset(closetOf(SEVEN));
    await render(<ClosetScreen />);

    expect(screen.queryByText(/to review/)).not.toBeOnTheScreen();
  });

  test('tapping a garment opens its detail', async () => {
    setCloset(closetOf(SEVEN));
    await render(<ClosetScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Jeans, never worn' }));

    expect(router.push).toHaveBeenCalledWith('/garment/g-3');
  });

  test('Gallery opens a multi-select picker of up to 30 photos and enqueues the picks', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///a.jpg' }, { uri: 'file:///b.heic' }] as ImagePicker.ImagePickerAsset[],
    });
    await render(<ClosetScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Gallery' }));

    await waitFor(() => {
      expect(mockQueueActions.enqueue).toHaveBeenCalledWith(['file:///a.jpg', 'file:///b.heic']);
    });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 30,
      quality: 1,
    });
  });

  test('a cancelled picker enqueues nothing', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null });
    await render(<ClosetScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Gallery' }));

    await waitFor(() => {
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
    });
    expect(mockQueueActions.enqueue).not.toHaveBeenCalled();
  });

  test('a gallery picker failure shows the picker error', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockRejectedValue(new Error('no photo access'));
    await render(<ClosetScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Gallery' }));

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith("Couldn't open your photos. Try again.");
    });
    expect(mockQueueActions.enqueue).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  test('Burst mode opens the camera', async () => {
    await render(<ClosetScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Burst mode' }));

    expect(router.push).toHaveBeenCalledWith('/camera');
  });

  test('polls pending extractions while focused', async () => {
    await render(<ClosetScreen />);

    expect(usePendingPolling).toHaveBeenLastCalledWith(true);
  });

  test('offline shows a note above the saved closet', async () => {
    setCloset(closetOf(SEVEN), 'offline');
    await render(<ClosetScreen />);

    expect(screen.getByText("You're offline. Showing your saved closet.")).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(7);
  });
});
