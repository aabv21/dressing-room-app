// The Closet tab's Diary segment (mockup 04 screen 3): a Monday-first month calendar with each
// worn day's outfit thumbnail, prev/next months, a tapped day's wears (pieces, occasion, score) and
// deleting a wear, which also clears Today's "Logged ✓" when the wear is today's.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import ClosetScreen from '../app/(tabs)/closet';
import type { Garment } from '../closet/garmentRepository';
import { formatDayTitle, formatMonthTitle } from '../closet/DiarySegment';
import { translate } from '../i18n';
import { kvRemove } from '../lib/kv';
import { isWornToday, markWornToday } from '../outfits/wornToday';
import { readStoredWears, storedWearsKey, storeWears } from '../stats/storedWears';
import { deleteWear, listWears, type WearWithItems } from '../stats/wearsRepository';
import { garment } from '../test/garmentFixture';
import { colors } from '../ui/theme';

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
jest.mock('../outfits/aiClient', () => ({ localDate: () => '2026-10-28' }));
jest.mock('../stats/wearsRepository', () => ({ listWears: jest.fn(), deleteWear: jest.fn() }));
jest.mock('../closet/garmentRepository', () => ({ updateGarment: jest.fn() }));
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));

const mockRefresh = jest.fn(() => Promise.resolve());
const mockCloset: { garments: Garment[]; thumbUrls: Map<string, string> } = { garments: [], thumbUrls: new Map() };
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockCloset.garments,
    thumbUrls: mockCloset.thumbUrls,
    status: 'ready',
    refresh: mockRefresh,
    replaceLocal: () => undefined,
    removeLocal: () => undefined,
  }),
  usePendingPolling: jest.fn(),
}));
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

const BLOUSE = '00000000-0000-4000-8000-000000000001';
const JEANS = '00000000-0000-4000-8000-000000000002';
const SNEAKERS = '00000000-0000-4000-8000-000000000003';
const DRESS = '00000000-0000-4000-8000-000000000004';
const COAT = '00000000-0000-4000-8000-000000000005';
const TEE = '00000000-0000-4000-8000-000000000006';

const done = { extraction_status: 'done', reviewed_at: '2026-09-01T12:00:00.000Z' } as const;
const CLOSET: Garment[] = [
  garment({ ...done, id: BLOUSE, category: 'blouse', colors: ['white'], wear_count: 9, photo_version: 2 }),
  garment({ ...done, id: JEANS, category: 'jeans', colors: ['blue'], wear_count: 12 }),
  garment({ ...done, id: SNEAKERS, category: 'sneakers', colors: ['white'], wear_count: 14 }),
  garment({ ...done, id: DRESS, category: 'dress', colors: ['black'], wear_count: 3 }),
  garment({ ...done, id: COAT, category: 'coat', colors: ['camel'], wear_count: 2 }),
  // Donated since: its past wears still show in the diary.
  garment({ ...done, id: TEE, category: 't_shirt', colors: ['black'], wear_count: 4, status: 'donated' }),
];
const thumbUrl = (id: string) => `https://cdn.test/${id}/thumb.webp`;

const OFFICE_OUTFIT = [JEANS, BLOUSE, SNEAKERS];
const TODAY_WEAR: WearWithItems = { id: 'w-28', wornOn: '2026-10-28', occasion: 'office', score: 78, garmentIds: OFFICE_OUTFIT };

/**
 * October 2026 as in mockup 04: 18 worn days. Oct 21 has two wears, the dress outfit logged last
 * (listed first, as listWears returns them newest first). Oct 7 layers a coat over the tee.
 */
function october(): WearWithItems[] {
  const days = [1, 2, 4, 6, 7, 8, 10, 11, 13, 15, 16, 18, 20, 21, 23, 24, 27];
  const wears: WearWithItems[] = [TODAY_WEAR];
  for (const day of [...days].reverse()) {
    const wornOn = `2026-10-${String(day).padStart(2, '0')}`;
    if (day === 21) {
      wears.push(
        { id: 'w-21-late', wornOn, occasion: 'going_out', score: null, garmentIds: [SNEAKERS, DRESS] },
        { id: 'w-21-early', wornOn, occasion: 'home', score: 64, garmentIds: [TEE, JEANS, SNEAKERS] },
      );
    } else if (day === 7) {
      wears.push({ id: 'w-07', wornOn, occasion: null, score: 70, garmentIds: [COAT, JEANS, TEE, SNEAKERS] });
    } else {
      wears.push({ id: `w-${String(day)}`, wornOn, occasion: null, score: null, garmentIds: [JEANS, BLOUSE] });
    }
  }
  return wears;
}

// The device's text size (iOS Dynamic Type, Android font scale).
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockedListWears = jest.mocked(listWears);
const mockedDeleteWear = jest.mocked(deleteWear);

beforeEach(() => {
  jest.clearAllMocks();
  mockWindow.fontScale = 1;
  mockCloset.garments = CLOSET;
  mockCloset.thumbUrls = new Map(CLOSET.map((g) => [g.id, thumbUrl(g.id)]));
  mockedListWears.mockImplementation((from) => Promise.resolve(from === '2026-10-01' ? october() : []));
  mockedDeleteWear.mockResolvedValue({ ok: true });
  kvRemove('outfit.worn.user-1');
  kvRemove(storedWearsKey('user-1'));
});

/** The buttons of the last `Alert.alert` call. */
function lastAlertButtons(spy: jest.SpyInstance): AlertButton[] {
  const call = spy.mock.calls.at(-1) as [string, string, AlertButton[]] | undefined;
  if (call === undefined) throw new Error('no alert was shown');
  return call[2];
}

async function openDiary(): Promise<void> {
  await render(<ClosetScreen />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Diary' }));
  await screen.findByText('19 outfits');
}

// expo-image hands its native view the source as a list.
const thumbSource = (day: string) =>
  (screen.getByTestId(`diary-thumb-${day}`).props.source as { uri: string; cacheKey: string }[])[0];
const hidden = { includeHiddenElements: true };
const wearCard = (id: string) => screen.getByTestId(`diary-wear-${id}`);

describe('month view', () => {
  test("October 2026 shows its 18 worn days, each with the latest wear's top or one-piece", async () => {
    await openDiary();

    expect(mockedListWears).toHaveBeenCalledWith('2026-10-01', '2026-10-31');
    expect(screen.getByRole('header', { name: 'October 2026' })).toBeOnTheScreen();
    // At a large text size the month title wraps between its arrows, and the count goes under it.
    expect(screen.getByRole('header', { name: 'October 2026' })).toHaveStyle({ flexShrink: 1 });
    expect(screen.getByTestId('diary-month-nav')).toHaveStyle({ flexShrink: 1 });
    expect(screen.getByTestId('diary-month-row')).toHaveStyle({ flexWrap: 'wrap' });
    // Five Monday-first weeks: Sep 28 – Nov 1, no trailing week of November only. The other months'
    // days are hidden from screen readers.
    expect(screen.getAllByTestId(/^diary-cell-/, hidden)).toHaveLength(35);
    expect(screen.getAllByTestId(/^diary-cell-/)).toHaveLength(31);
    expect(screen.getByTestId('diary-cell-2026-09-28', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('diary-cell-2026-11-02', hidden)).toBeNull();

    expect(screen.getAllByTestId(/^diary-thumb-/)).toHaveLength(18);
    expect(screen.queryByTestId('diary-thumb-2026-10-03')).toBeNull();
    // The grid's disk-cache key, so the same file serves both.
    expect(thumbSource('2026-10-28')).toEqual({ uri: thumbUrl(BLOUSE), cacheKey: `${BLOUSE}:thumb:2` });
    // The top under the coat, not the coat.
    expect(thumbSource('2026-10-07')?.uri).toBe(thumbUrl(TEE));
    // Oct 21's latest wear is the dress (a one-piece).
    expect(thumbSource('2026-10-21')?.uri).toBe(thumbUrl(DRESS));

    expect(screen.getByTestId('diary-cell-2026-10-28')).toHaveProp(
      'accessibilityLabel',
      'Wednesday, October 28, Today, 1 outfit',
    );
    expect(screen.getByTestId('diary-cell-2026-10-21')).toHaveProp('accessibilityLabel', 'Wednesday, October 21, 2 outfits');
  });

  test('day numbers meet text contrast and stay inside their cells at a large text size', async () => {
    await openDiary();
    // Oct 3 is unworn, Oct 28 is worn: both read in the muted ink or darker, never the old light grey.
    const unworn = within(screen.getByTestId('diary-cell-2026-10-03')).getByText('3');
    expect(unworn).toHaveStyle({ color: colors.muted });
    expect(unworn).toHaveProp('maxFontSizeMultiplier', 1.45);
    expect(within(screen.getByTestId('diary-cell-2026-10-28')).getByText('28')).toHaveProp('maxFontSizeMultiplier', 1.45);
    expect(screen.getByTestId('diary-thumb-2026-10-28')).toHaveStyle({ width: '58%' });
  });

  test('at the largest text size a worn day shrinks its thumbnail so the number and photo fit the cell', async () => {
    mockWindow.fontScale = 2;
    await openDiary();

    expect(screen.getByTestId('diary-thumb-2026-10-28')).toHaveStyle({ width: '46%' });
    expect(within(screen.getByTestId('diary-cell-2026-10-28')).getByText('28')).toHaveProp('maxFontSizeMultiplier', 1.45);
  });

  test('prev and next change the month and refetch; next stops at the current month', async () => {
    await openDiary();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('header', { name: 'September 2026' })).toBeOnTheScreen();
    expect(mockedListWears).toHaveBeenLastCalledWith('2026-09-01', '2026-09-30');
    expect(await screen.findByText('No outfits logged this month')).toBeOnTheScreen();
    expect(screen.queryByText(/outfits?$/)).toBeNull();
    expect(screen.queryAllByTestId(/^diary-thumb-/)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();

    // August 2026 starts on a Saturday and needs all six weeks.
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('header', { name: 'August 2026' })).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^diary-cell-/, hidden)).toHaveLength(42);

    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByText('19 outfits')).toBeOnTheScreen();
    // October, September, August, September, October.
    expect(mockedListWears).toHaveBeenCalledTimes(5);
    expect(mockedListWears).toHaveBeenLastCalledWith('2026-10-01', '2026-10-31');
  });

  test('a fetched month is stored up to today', async () => {
    await openDiary();

    expect(readStoredWears('user-1')).toEqual({ from: '2026-10-01', to: '2026-10-28', wears: october() });
  });

  test('offline diary shows a stored month, and a month before the stored range shows the error', async () => {
    storeWears('user-1', '2026-10-01', '2026-10-28', october());
    mockedListWears.mockRejectedValue(new Error('offline'));
    await render(<ClosetScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Diary' }));

    expect(await screen.findByText('19 outfits')).toBeOnTheScreen();
    expect(screen.getByText('Offline — your history as of October 28.')).toBeOnTheScreen();
    for (const button of screen.getAllByRole('button', { name: 'Delete' })) expect(button).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByText("Couldn't load your outfit history. Check your internet and try again.")).toBeOnTheScreen();
  });

  test('a load failure shows the error instead of the count', async () => {
    mockedListWears.mockRejectedValue(new Error('offline'));
    await render(<ClosetScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Diary' }));

    expect(await screen.findByText("Couldn't load your outfit history. Check your internet and try again.")).toBeOnTheScreen();
    expect(screen.queryByText('No outfits logged this month')).toBeNull();
  });
});

describe('day detail', () => {
  test("opens on the latest worn day; tapping a day shows its wears' pieces, occasion and score", async () => {
    await openDiary();

    const today = wearCard('w-28');
    expect(within(today).getByText('Wednesday 28')).toBeOnTheScreen();
    expect(within(today).getByText('Office · 78%')).toBeOnTheScreen();
    // At a large text size the occasion and score wrap under the day instead of squeezing it.
    expect(within(today).getByText('Wednesday 28').parent).toHaveStyle({ flexWrap: 'wrap' });
    for (const id of OFFICE_OUTFIT) {
      expect(within(today).getByTestId(`outfit-piece-${id}`)).toBeOnTheScreen();
    }
    expect(within(today).getByLabelText('Blouse · White, 9 wears')).toBeOnTheScreen();
    expect(screen.getByTestId('diary-cell-2026-10-28')).toBeSelected();

    await fireEvent.press(screen.getByTestId('diary-cell-2026-10-21'));
    expect(screen.getByTestId('diary-cell-2026-10-21')).toBeSelected();
    expect(screen.queryByTestId('diary-wear-w-28')).toBeNull();

    // Both of the day's wears, the latest first; no score means no "· %".
    const late = wearCard('w-21-late');
    expect(within(late).getByText('Going out')).toBeOnTheScreen();
    expect(within(late).getByTestId(`outfit-piece-${DRESS}`)).toBeOnTheScreen();
    const early = wearCard('w-21-early');
    expect(within(early).getByText('Home · 64%')).toBeOnTheScreen();
    // A donated piece's past wear still shows it.
    expect(within(early).getByTestId(`outfit-piece-${TEE}`)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('diary-cell-2026-10-07'));
    expect(within(wearCard('w-07')).getByText('70%')).toBeOnTheScreen();
  });

  test('an unworn day is not a button', async () => {
    await openDiary();
    expect(screen.getByTestId('diary-cell-2026-10-03')).not.toHaveProp('accessibilityRole', 'button');
    expect(screen.getByTestId('diary-cell-2026-10-28')).toHaveProp('accessibilityRole', 'button');
  });
});

describe('deleting a wear', () => {
  test("today's wear: confirms, deletes, then clears Today's Logged ✓ and refreshes the month and the closet", async () => {
    markWornToday('user-1', '2026-10-28', [BLOUSE, SNEAKERS, JEANS]);
    const alert = jest.spyOn(Alert, 'alert');
    let finish: (value: { ok: true }) => void = () => undefined;
    mockedDeleteWear.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await openDiary();
    mockedListWears.mockResolvedValue(october().filter((w) => w.id !== 'w-28'));

    await fireEvent.press(within(wearCard('w-28')).getByRole('button', { name: 'Delete' }));
    expect(alert).toHaveBeenCalledWith('Delete this outfit?', expect.any(String), expect.any(Array));
    const confirm = lastAlertButtons(alert).find((button) => button.style === 'destructive');
    expect(confirm?.text).toBe('Delete');

    await act(() => {
      confirm?.onPress?.();
    });
    expect(mockedDeleteWear).toHaveBeenCalledWith('w-28');
    // Still logged until the delete succeeds.
    expect(isWornToday('user-1', '2026-10-28', OFFICE_OUTFIT)).toBe(true);

    await act(async () => {
      finish({ ok: true });
      await Promise.resolve();
    });
    expect(isWornToday('user-1', '2026-10-28', OFFICE_OUTFIT)).toBe(false);
    expect(await screen.findByText('18 outfits')).toBeOnTheScreen();
    expect(mockedListWears).toHaveBeenCalledTimes(2);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('diary-thumb-2026-10-28')).toBeNull();
    expect(screen.queryByTestId('diary-wear-w-28')).toBeNull();
    alert.mockRestore();
  });

  test("an earlier day's wear leaves Today's record alone; cancelling deletes nothing", async () => {
    markWornToday('user-1', '2026-10-28', [JEANS, TEE, SNEAKERS]);
    const alert = jest.spyOn(Alert, 'alert');
    await openDiary();
    await fireEvent.press(screen.getByTestId('diary-cell-2026-10-21'));

    await fireEvent.press(within(wearCard('w-21-early')).getByRole('button', { name: 'Delete' }));
    await act(() => {
      lastAlertButtons(alert)
        .find((button) => button.style === 'cancel')
        ?.onPress?.();
    });
    expect(mockedDeleteWear).not.toHaveBeenCalled();

    await fireEvent.press(within(wearCard('w-21-early')).getByRole('button', { name: 'Delete' }));
    await act(async () => {
      lastAlertButtons(alert)
        .find((button) => button.style === 'destructive')
        ?.onPress?.();
      await Promise.resolve();
    });
    expect(mockedDeleteWear).toHaveBeenCalledWith('w-21-early');
    expect(isWornToday('user-1', '2026-10-28', [JEANS, TEE, SNEAKERS])).toBe(true);
    alert.mockRestore();
  });

  test('a failed delete keeps the wear and shows the error', async () => {
    markWornToday('user-1', '2026-10-28', OFFICE_OUTFIT);
    mockedDeleteWear.mockResolvedValue({ ok: false, error: 'network' });
    const alert = jest.spyOn(Alert, 'alert');
    await openDiary();

    await fireEvent.press(within(wearCard('w-28')).getByRole('button', { name: 'Delete' }));
    await act(async () => {
      lastAlertButtons(alert)
        .find((button) => button.style === 'destructive')
        ?.onPress?.();
      await Promise.resolve();
    });

    expect(await screen.findByText("Couldn't delete this outfit. Check your internet and try again.")).toBeOnTheScreen();
    expect(wearCard('w-28')).toBeOnTheScreen();
    expect(screen.getByText('19 outfits')).toBeOnTheScreen();
    expect(isWornToday('user-1', '2026-10-28', OFFICE_OUTFIT)).toBe(true);
    expect(mockedListWears).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

describe('empty and localized', () => {
  test('an empty month says so, in English and Spanish', async () => {
    mockedListWears.mockResolvedValue([]);
    await render(<ClosetScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Diary' }));

    expect(await screen.findByText('No outfits logged this month')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^diary-thumb-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^diary-wear-/)).toHaveLength(0);
    expect(translate('es', 'diary.empty')).toBe('Sin outfits registrados este mes');
  });

  test('month and day titles follow the locale, capitalized for Spanish', () => {
    expect(formatMonthTitle('en', 2026, 10)).toBe('October 2026');
    expect(formatMonthTitle('es', 2026, 10)).toBe('Octubre 2026');
    expect(formatDayTitle('en', '2026-10-28')).toBe('Wednesday 28');
    expect(formatDayTitle('es', '2026-10-27')).toBe('Martes 27');
    expect(translate('es', 'diary.outfits.other', { count: 18 })).toBe('18 outfits');
  });
});
