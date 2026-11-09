// The Closet tab's segments (mockup 04 screens 1–2): Items | Stats | Diary, the Stats segment's
// period chips, KPIs, most-worn bars, colors, balance and the unused list, and donated garments
// hidden from the active closet. The closet is a small external store so `replaceLocal` re-renders
// the screen as the real provider does.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import BuildScreen from '../app/(tabs)/build';
import ClosetScreen from '../app/(tabs)/closet';
import { updateGarment, type Garment } from '../closet/garmentRepository';
import { localDate } from '../outfits/aiClient';
import { listWears, type WearWithItems } from '../stats/wearsRepository';
import { garment } from '../test/garmentFixture';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('@shopify/flash-list', () => require('../test/flashListMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- see src/test/reanimatedMock.ts's module doc
jest.mock('react-native-reanimated', () => require('../test/reanimatedMock'));
jest.mock('../perf/useFrameStats', () => ({
  useFrameStats: () => ({
    stats: { frames: 0, dropped: 0, droppedRatio: 0, p95Ms: 0, medianMs: 0 },
    reset: () => undefined,
  }),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useIsFocused: jest.fn(() => true),
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../outfits/aiClient', () => ({ localDate: jest.fn(() => '2026-11-08') }));
jest.mock('../stats/wearsRepository', () => ({ listWears: jest.fn() }));
// The Diary segment reads the signed-in user (its deletes clear Today's worn record).
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));
jest.mock('../closet/garmentRepository', () => ({ updateGarment: jest.fn() }));

const mockStore: { garments: Garment[]; listeners: Set<() => void> } = { garments: [], listeners: new Set() };
function mockSetGarments(next: Garment[]): void {
  mockStore.garments = next;
  for (const listener of mockStore.listeners) listener();
}
jest.mock('../closet/ClosetProvider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock()'s factory can only reference globals (incl. `require`)
  const { useSyncExternalStore } = require('react') as typeof import('react');
  const subscribe = (listener: () => void) => {
    mockStore.listeners.add(listener);
    return () => {
      mockStore.listeners.delete(listener);
    };
  };
  return {
    useCloset: () => {
      const garments = useSyncExternalStore(subscribe, () => mockStore.garments);
      return {
        garments,
        thumbUrls: new Map<string, string>(),
        status: 'ready',
        refresh: () => Promise.resolve(),
        replaceLocal: (g: Garment) => {
          mockSetGarments(mockStore.garments.map((entry) => (entry.id === g.id ? g : entry)));
        },
        removeLocal: () => undefined,
      };
    },
    usePendingPolling: jest.fn(),
  };
});
jest.mock('../closet/UploadQueueProvider', () => ({
  useUploadQueue: () => ({
    pending: 0,
    failed: 0,
    enqueue: jest.fn(),
    enqueueReplacement: jest.fn(),
    retryFailed: jest.fn(),
    discardFailed: jest.fn(),
  }),
}));

const JEANS = '00000000-0000-4000-8000-000000000001';
const SNEAKERS = '00000000-0000-4000-8000-000000000002';
const BLOUSE = '00000000-0000-4000-8000-000000000003';
const SKIRT = '00000000-0000-4000-8000-000000000004';
const OLD_COAT = '00000000-0000-4000-8000-000000000005';
const DONATED_TEE = '00000000-0000-4000-8000-000000000006';

const done = { extraction_status: 'done', reviewed_at: '2026-11-01T12:00:00.000Z' } as const;
const CLOSET: Garment[] = [
  garment({ ...done, id: JEANS, category: 'jeans', colors: ['blue'], wear_count: 21 }),
  garment({ ...done, id: SNEAKERS, category: 'sneakers', colors: ['white'], wear_count: 14 }),
  garment({ ...done, id: BLOUSE, category: 'blouse', colors: ['white'], wear_count: 7 }),
  garment({ ...done, id: SKIRT, category: 'skirt', colors: ['camel'], wear_count: 1 }),
  garment({ ...done, id: OLD_COAT, category: 'coat', colors: ['green'], created_at: '2026-01-10T12:00:00.000Z' }),
  garment({
    ...done,
    id: DONATED_TEE,
    category: 't_shirt',
    colors: ['black'],
    status: 'donated',
    wear_count: 1,
    created_at: '2026-01-10T12:00:00.000Z',
  }),
];

/**
 * 21 wears from Nov 1 to Nov 7 (3 a day): jeans in all of them, sneakers in the first 14 and the
 * blouse in the last 7; every third wear scores 91, the rest 70 (mean 77). One October wear with
 * the skirt and the since-donated tee sits outside the month.
 */
function history(): WearWithItems[] {
  const wears: WearWithItems[] = [];
  for (let i = 0; i < 21; i += 1) {
    const day = `2026-11-0${String(1 + Math.floor(i / 3))}`;
    wears.push({
      id: `w-${String(i)}`,
      wornOn: day,
      occasion: null,
      score: i % 3 === 0 ? 91 : 70,
      garmentIds: [JEANS, i < 14 ? SNEAKERS : BLOUSE],
    });
  }
  wears.push({ id: 'w-oct', wornOn: '2026-10-15', occasion: null, score: null, garmentIds: [SKIRT, DONATED_TEE] });
  return wears.reverse();
}

// The device's text size (iOS Dynamic Type, Android font scale). Jest's own default is 2.
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockedListWears = jest.mocked(listWears);
const mockedUpdate = jest.mocked(updateGarment);
const mockedPush = jest.mocked(router.push);
const mockedLocalDate = jest.mocked(localDate);

beforeEach(() => {
  jest.clearAllMocks();
  mockWindow.fontScale = 1;
  mockSetGarments(CLOSET);
  mockedListWears.mockResolvedValue(history());
  mockedUpdate.mockResolvedValue({ ok: true });
  mockedLocalDate.mockReturnValue('2026-11-08');
});

const tab = (name: string) => screen.getByRole('tab', { name });

/** Opens Stats and waits for the history, for closets whose KPIs aren't the fixture's 60%. */
async function openStatsLoaded(): Promise<void> {
  await render(<ClosetScreen />);
  await fireEvent.press(tab('Stats'));
  await screen.findByText('outfits logged');
}

async function openStats(): Promise<void> {
  await render(<ClosetScreen />);
  await fireEvent.press(tab('Stats'));
  await screen.findByText('60%');
}

describe('segments', () => {
  test('the tabs switch between Items, Stats and Diary', async () => {
    await render(<ClosetScreen />);
    expect(tab('Items')).toBeSelected();
    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(5);

    await fireEvent.press(tab('Stats'));
    expect(tab('Stats')).toBeSelected();
    expect(tab('Items')).not.toBeSelected();
    expect(await screen.findByText('What you wear most')).toBeOnTheScreen();
    expect(screen.queryByTestId(/^grid-cell-/)).not.toBeOnTheScreen();

    await fireEvent.press(tab('Diary'));
    expect(tab('Diary')).toBeSelected();
    expect(screen.queryByText('What you wear most')).not.toBeOnTheScreen();

    await fireEvent.press(tab('Items'));
    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(5);
  });
});

describe('stats', () => {
  test('fetches a year of wears and renders the KPIs for the month', async () => {
    await openStats();

    expect(mockedListWears).toHaveBeenCalledWith('2025-11-08', '2026-11-08');
    expect(screen.getByRole('radio', { name: 'Month' })).toBeSelected();
    expect(screen.getByText('of your closet worn this month')).toBeOnTheScreen();
    expect(screen.getByText('21')).toBeOnTheScreen();
    expect(screen.getByText('outfits logged')).toBeOnTheScreen();
    expect(screen.getByText('77%')).toBeOnTheScreen();
    expect(screen.getByText('average outfit score')).toBeOnTheScreen();
    expect(screen.getByText('7 days')).toBeOnTheScreen();
    expect(screen.getByText('in a row')).toBeOnTheScreen();
  });

  test('switching the period rescopes the KPIs from the same year of history', async () => {
    await openStats();

    await fireEvent.press(screen.getByRole('radio', { name: '6 months' }));

    // The October wear adds the skirt (the donated tee doesn't count): 4 of 5 active garments.
    expect(await screen.findByText('80%')).toBeOnTheScreen();
    expect(mockedListWears).toHaveBeenCalledTimes(1);
    expect(screen.getByText('of your closet worn these 6 months')).toBeOnTheScreen();
    expect(screen.getByText('22')).toBeOnTheScreen();
  });

  test('most worn: the first tap shows the detail, the second opens the garment', async () => {
    await openStats();
    expect(screen.getByRole('button', { name: 'Sneakers · White, 14 wears' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Blouse · White, 7 wears' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Jeans · Blue, 21 wears' }));
    expect(screen.getByText('21 wears · last: yesterday')).toBeOnTheScreen();
    expect(mockedPush).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Jeans · Blue, 21 wears' }));
    expect(mockedPush).toHaveBeenCalledWith(`/garment/${JEANS}`);
  });

  test('a color tap opens Items filtered to that color, and the chip clears it', async () => {
    await openStats();
    expect(screen.queryByText(/^Black /)).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('proportion-legend-white'));

    expect(tab('Items')).toBeSelected();
    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(2);
    expect(screen.getByTestId(`grid-cell-${SNEAKERS}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`grid-cell-${BLOUSE}`)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear the White filter' }));
    expect(screen.getAllByTestId(/^grid-cell-/)).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Clear the White filter' })).not.toBeOnTheScreen();
  });

  test("a card's title and its aside wrap onto two lines at a large text size, never squeezing the title out", async () => {
    await openStats();
    const header = screen.getByRole('header', { name: 'Your colors' }).parent;
    expect(header).toHaveStyle({ flexWrap: 'wrap' });
  });

  test('an unused row keeps its label and buttons on one line at the default text size', async () => {
    await openStats();
    const row = screen.getByTestId(`unused-row-${OLD_COAT}`);
    expect(row).toHaveStyle({ flexDirection: 'row' });
    expect(within(row).getByText('Coat · Green')).toHaveProp('numberOfLines', 1);
  });

  test('at the largest text sizes an unused row puts its label on its own line, with the buttons wrapping under it', async () => {
    mockWindow.fontScale = 3.1;
    await openStats();
    const row = screen.getByTestId(`unused-row-${OLD_COAT}`);
    expect(row).toHaveStyle({ flexDirection: 'column' });
    expect(within(row).getByText('Coat · Green').props.numberOfLines).toBeUndefined();
    expect(screen.getByTestId(`unused-minis-${OLD_COAT}`)).toHaveStyle({ flexWrap: 'wrap' });
    expect(within(row).getByRole('button', { name: 'Wear it, Coat · Green' })).toBeOnTheScreen();
    expect(within(row).getByRole('button', { name: 'Donate, Coat · Green' })).toBeOnTheScreen();
  });

  test('balance shows the slot counts, and the insight opens For you', async () => {
    await openStats();

    expect(screen.getByText('Closet balance')).toBeOnTheScreen();
    expect(screen.getByLabelText('Top, 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Bottom, 2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Shoes, 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Over, 1')).toBeOnTheScreen();

    const insight = screen.getByRole('link', {
      name: 'Tip: One more top that matches would take you from 2 to 4 possible outfits. → For you',
    });
    await fireEvent.press(insight);
    expect(mockedPush).toHaveBeenCalledWith('/for-you');
  });

  test('"Wear it" pins the garment for tomorrow', async () => {
    await openStats();
    expect(screen.getByText('Unused for 6 months')).toBeOnTheScreen();
    expect(screen.getByText('Coat · Green')).toBeOnTheScreen();
    expect(screen.queryByText('T-shirt · Black')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Wear it, Coat · Green' }));

    expect(mockedUpdate).toHaveBeenCalledWith(OLD_COAT, { pinned_on: '2026-11-09' });
    expect(await screen.findByText('Pinned for tomorrow ✓')).toBeOnTheScreen();
  });

  test('a pinned row keeps Donate', async () => {
    await openStats();

    await fireEvent.press(screen.getByRole('button', { name: 'Wear it, Coat · Green' }));

    expect(await screen.findByText('Pinned for tomorrow ✓')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Donate, Coat · Green' })).toBeOnTheScreen();
  });

  test('a lent or uncategorized row offers no "Wear it", only Donate', async () => {
    const old = { ...done, created_at: '2026-01-10T12:00:00.000Z' } as const;
    mockSetGarments([
      garment({ ...old, id: OLD_COAT, category: 'coat', colors: ['green'], status: 'lent' }),
      garment({ ...old, id: 'unnamed-1', colors: ['red'] }),
    ]);
    await openStatsLoaded();

    expect(screen.getByText('Lent out')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Wear it/ })).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Donate, Coat · Green' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Donate, .* · Red$/ })).toBeOnTheScreen();
  });

  test('"Wear it" pins for the day after the tap, even past midnight', async () => {
    await openStats();
    mockedLocalDate.mockReturnValue('2026-11-09');

    await fireEvent.press(screen.getByRole('button', { name: 'Wear it, Coat · Green' }));

    expect(mockedUpdate).toHaveBeenCalledWith(OLD_COAT, { pinned_on: '2026-11-10' });
    expect(await screen.findByText('Pinned for tomorrow ✓')).toBeOnTheScreen();
  });

  test('a pin commits onto the newest copy of the garment', async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    mockedUpdate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await openStats();

    await fireEvent.press(screen.getByRole('button', { name: 'Wear it, Coat · Green' }));
    // A refresh lands while the pin is in flight.
    await act(async () => {
      mockSetGarments(mockStore.garments.map((g) => (g.id === OLD_COAT ? { ...g, wear_count: 3 } : g)));
      await Promise.resolve();
    });
    await act(async () => {
      finish({ ok: true });
      await Promise.resolve();
    });

    expect(mockStore.garments.find((g) => g.id === OLD_COAT)).toMatchObject({
      wear_count: 3,
      pinned_on: '2026-11-09',
    });
  });

  test('"Donate" confirms, sets donated and the row disappears', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await openStats();

    await fireEvent.press(screen.getByRole('button', { name: 'Donate, Coat · Green' }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(mockedUpdate).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    expect(buttons.map((button) => button.text)).toEqual(['Cancel', 'Donate']);

    await act(async () => {
      buttons.find((button) => button.text === 'Donate')?.onPress?.();
      await Promise.resolve();
    });

    expect(mockedUpdate).toHaveBeenCalledWith(OLD_COAT, { status: 'donated' });
    await waitFor(() => {
      expect(screen.queryByText('Coat · Green')).not.toBeOnTheScreen();
    });
    expect(screen.queryByText('Unused for 6 months')).not.toBeOnTheScreen();
  });

  test('a failed pin shows the error and keeps the buttons', async () => {
    mockedUpdate.mockResolvedValue({ ok: false, error: 'network' });
    await openStats();

    await fireEvent.press(screen.getByRole('button', { name: 'Wear it, Coat · Green' }));

    expect(await screen.findByText("Couldn't save. Check your internet and try again.")).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Wear it, Coat · Green' })).toBeOnTheScreen();
    expect(screen.queryByText('Pinned for tomorrow ✓')).not.toBeOnTheScreen();
  });

  test('an empty closet and history render zeros without crashing', async () => {
    mockSetGarments([]);
    mockedListWears.mockResolvedValue([]);
    await render(<ClosetScreen />);
    await fireEvent.press(tab('Stats'));

    expect(await screen.findByText('0%')).toBeOnTheScreen();
    // The outfits KPI plus the four balance rows.
    expect(screen.getAllByText('0')).toHaveLength(5);
    expect(screen.getByLabelText('Top, 0')).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(screen.getByText('0 days')).toBeOnTheScreen();
    expect(screen.getByText('Nothing logged in this period yet.')).toBeOnTheScreen();
    expect(screen.queryByText('Your colors')).not.toBeOnTheScreen();
    expect(screen.queryByText('Unused for 6 months')).not.toBeOnTheScreen();
    expect(screen.queryByText(/^Tip:/)).not.toBeOnTheScreen();
  });

  test('a failed history fetch shows an error line', async () => {
    mockedListWears.mockRejectedValue(new Error('offline'));
    await render(<ClosetScreen />);
    await fireEvent.press(tab('Stats'));

    expect(await screen.findByText("Couldn't load your outfit history. Check your internet and try again.")).toBeOnTheScreen();
  });
});

describe('donated garments', () => {
  test('are gone from Items, the slot counts and the goal', async () => {
    await render(<ClosetScreen />);

    expect(screen.queryByTestId(`grid-cell-${DONATED_TEE}`)).not.toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'All 5' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Tops 1' })).toBeOnTheScreen();
    expect(screen.getByText('5/10')).toBeOnTheScreen();
  });

  test('are gone from Build', async () => {
    await render(<BuildScreen />);

    expect(screen.getByRole('button', { name: 'Blouse, 7 wears' })).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^T-shirt/)).not.toBeOnTheScreen();
  });
});
