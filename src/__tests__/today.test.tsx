// The Today tab (mockup 01 screen 1): the weather line, occasion chips, the "feeling lucky" card,
// "Another" and "I'll wear it". Rendered directly with the closet, auth, the AI client and the
// outfit repository mocked.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as Speech from 'expo-speech';
import { Alert, AppState, Linking, type AppStateStatus } from 'react-native';

import TodayScreen from '../app/(tabs)/index';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Garment } from '../closet/garmentRepository';
import { kvGet, kvRemove, kvSet } from '../lib/kv';
import { storeLucky } from '../outfits/storedLucky';
import { fetchLuckyList, type AiOutcome } from '../outfits/aiClient';
import { logWear } from '../outfits/outfitRepository';
import { dismissOutfit, stopSuggesting, undismissOutfit } from '../outfits/suggestionFeedback';
import { storedDismissedKey } from '../outfits/storedDismissed';
import { dequeueWear, queuedWears, wearQueueKey } from '../outfits/wearQueue';
import { CLOSET_REFETCH_DELAY_MS } from '../outfits/useLuckyList';
import { getProfile, type Profile, type ProfilePatch } from '../profile/profileRepository';
import type { LuckyOutfit, LuckyResponse, WeatherSummary } from '../outfits/types';
import { listPlans, type PlannedOutfit } from '../planner/plannedOutfits';
import { plansKey } from '../planner/planCache';
import { hear, recognition } from '../test/dictation';
import { garment } from '../test/garmentFixture';

const TOP = '00000000-0000-4000-8000-000000000001';
const JEANS = '00000000-0000-4000-8000-000000000002';
const SNEAKERS = '00000000-0000-4000-8000-000000000003';
const SKIRT = '00000000-0000-4000-8000-000000000004';
const BAG = '00000000-0000-4000-8000-000000000005';

const mockFocus = { focused: true };
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useIsFocused: () => mockFocus.focused,
}));

const mockAuth: { userId: string; profile: ProfilePatch; profileStatus: 'ready' } = {
  userId: 'user-1',
  profile: { city_name: null },
  profileStatus: 'ready',
};
jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => mockAuth,
}));

const mockCloset: { garments: Garment[]; status: 'loading' | 'ready' | 'offline' } = { garments: [], status: 'ready' };
const mockRefresh = jest.fn(() => Promise.resolve());
const mockReplaceLocal = jest.fn();
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockCloset.garments,
    thumbUrls: new Map<string, string>(),
    status: mockCloset.status,
    refresh: mockRefresh,
    replaceLocal: mockReplaceLocal,
    removeLocal: jest.fn(),
  }),
}));
jest.mock('../outfits/suggestionFeedback', () => ({
  dismissOutfit: jest.fn(),
  stopSuggesting: jest.fn(),
  undismissOutfit: jest.fn(),
  resumeSuggesting: jest.fn(),
}));

jest.mock('../outfits/aiClient', () => ({
  fetchLuckyList: jest.fn(),
}));
jest.mock('../lib/localDate', () => ({ localDate: () => '2026-11-08' }));

jest.mock('../outfits/outfitRepository', () => ({
  logWear: jest.fn(),
}));

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- the share and store sheets read Reduce Motion; see src/test/reanimatedMock.ts's module doc
jest.mock('react-native-reanimated', () => require('../test/reanimatedMock'));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(() => Promise.resolve(true)), shareAsync: jest.fn() }));
jest.mock('../stats/wearsRepository', () => ({ deleteWear: jest.fn(() => Promise.resolve({ ok: true })) }));

jest.mock('../profile/profileRepository', () => ({ getProfile: jest.fn() }));
jest.mock('../planner/plannedOutfits', () => ({ listPlans: jest.fn(), planOutfit: jest.fn(), removePlan: jest.fn() }));

const mockedFetch = jest.mocked(fetchLuckyList);
const mockedLogWear = jest.mocked(logWear);
const mockedUuid = jest.mocked(randomUUID);
const mockedPush = jest.mocked(router.push);
const mockedGetProfile = jest.mocked(getProfile);
const mockedListPlans = jest.mocked(listPlans);

const CLOSET: Garment[] = [
  garment({ id: TOP, category: 'blouse', colors: ['white'], extraction_status: 'done', wear_count: 9 }),
  garment({ id: JEANS, category: 'jeans', colors: ['blue'], extraction_status: 'done', wear_count: 21 }),
  garment({ id: SNEAKERS, category: 'sneakers', colors: ['white'], extraction_status: 'done', wear_count: 30 }),
  garment({ id: SKIRT, category: 'skirt', colors: ['camel'], extraction_status: 'done', wear_count: 1 }),
  garment({ id: BAG, category: 'bag', colors: ['brown'], extraction_status: 'done', wear_count: 4 }),
];

const SUNNY: WeatherSummary = { tempC: 24, condition: 'clear', band: 'hot', rain: false };

const FIRST: LuckyOutfit = { garmentIds: [SNEAKERS, JEANS, TOP, BAG], score: 88, freshThisWeek: true };
const SECOND: LuckyOutfit = { garmentIds: [TOP, SKIRT, SNEAKERS], score: 80, freshThisWeek: false };

function ok(response: LuckyResponse): Promise<AiOutcome<LuckyResponse>> {
  return Promise.resolve({ ok: true, result: response });
}

function list(outfits: LuckyOutfit[] = [FIRST, SECOND], weather: WeatherSummary | null = SUNNY): LuckyResponse {
  return { kind: 'ok', weather, outfits };
}

const KV_KEY = 'today.occasion.user-1.2026-11-08';

let appStateListeners: ((state: AppStateStatus) => void)[] = [];

beforeEach(() => {
  mockAuth.userId = 'user-1';
  mockAuth.profile = { city_name: null };
  mockFocus.focused = true;
  mockCloset.garments = CLOSET;
  mockCloset.status = 'ready';
  mockedFetch.mockReset();
  mockedLogWear.mockReset();
  kvRemove(wearQueueKey('user-1'));
  mockedUuid.mockReset();
  mockedUuid.mockReturnValueOnce('wear-1').mockReturnValueOnce('wear-2');
  mockedPush.mockClear();
  mockRefresh.mockClear();
  mockedGetProfile.mockReset();
  mockedGetProfile.mockResolvedValue({ city_name: null } as Profile);
  kvRemove(KV_KEY);
  kvRemove('outfit.worn.user-1');
  kvRemove('today.lucky.user-1');
  kvRemove(plansKey('user-1'));
  mockedListPlans.mockReset();
  mockedListPlans.mockResolvedValue([]);
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener);
    return { remove: jest.fn() };
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** A fetch that stays pending until the returned `resolve` is called. */
function deferred(response: LuckyResponse): { promise: Promise<AiOutcome<LuckyResponse>>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<AiOutcome<LuckyResponse>>((done) => {
    resolve = () => {
      done({ ok: true, result: response });
    };
  });
  return { promise, resolve };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('the lucky list', () => {
  test('renders the first outfit with its labels, wear counts, weather and the fresh line', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    expect(await screen.findByText('Blouse · White')).toBeOnTheScreen();
    expect(screen.getByText('TODAY')).toBeOnTheScreen();
    expect(screen.getByText('Feeling lucky')).toBeOnTheScreen();
    expect(screen.getByText('Jeans · Blue')).toBeOnTheScreen();
    expect(screen.getByText('9 wears')).toBeOnTheScreen();
    expect(screen.getByText('21 wears')).toBeOnTheScreen();
    expect(screen.getByText('30 wears')).toBeOnTheScreen();
    expect(screen.getByText('Nothing you wore this week')).toBeOnTheScreen();
    expect(screen.getByText(/^\w+ · 24 °C, sunny$/)).toBeOnTheScreen();
    // Slot order: top, bottom, shoes, bag.
    const rows = screen.getAllByTestId(/^outfit-piece-/).map((row) => row.props.testID as string);
    expect(rows).toEqual([TOP, JEANS, SNEAKERS, BAG].map((id) => `outfit-piece-${id}`));
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith({ occasion: null, date: '2026-11-08' });
  });

  test('"Another" shows the second outfit, then wraps to the first', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));
    expect(screen.getByText('Skirt · Camel')).toBeOnTheScreen();
    expect(screen.queryByText('Jeans · Blue')).toBeNull();
    expect(screen.queryByText('Nothing you wore this week')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));
    expect(screen.getByText('Jeans · Blue')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  test('choosing Office refetches with that occasion and keeps it for today', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    mockedFetch.mockReturnValue(ok(list([SECOND])));
    await fireEvent.press(screen.getByRole('radio', { name: 'Office' }));

    expect(await screen.findByText('Skirt · Camel')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenLastCalledWith({ occasion: 'office', date: '2026-11-08' });
    expect(kvGet(KV_KEY)).toBe('office');
    expect(screen.getByRole('radio', { name: 'Office' })).toBeSelected();
  });

  test("today's stored occasion is used on the next mount, and clearing it forgets it", async () => {
    mockedFetch.mockReturnValue(ok(list()));
    const first = await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Sport' }));
    await first.unmount();

    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');
    expect(mockedFetch).toHaveBeenLastCalledWith({ occasion: 'sport', date: '2026-11-08' });

    await fireEvent.press(screen.getByRole('radio', { name: 'Sport' }));
    expect(kvGet(KV_KEY)).toBeNull();
    expect(mockedFetch).toHaveBeenLastCalledWith({ occasion: null, date: '2026-11-08' });
  });

  test('a garment put in the laundry elsewhere hides its outfits at once and refetches after the debounce', async () => {
    jest.useFakeTimers();
    mockedFetch.mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    mockedFetch.mockReturnValue(ok(list([SECOND])));
    mockCloset.garments = CLOSET.map((g) => (g.id === JEANS ? { ...g, status: 'laundry' } : g));
    await view.rerender(<TodayScreen />);

    expect(screen.getByText('Skirt · Camel')).toBeOnTheScreen();
    expect(screen.queryByText('Jeans · Blue')).toBeNull();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    await advance(CLOSET_REFETCH_DELAY_MS);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  test('nothing is fetched while the closet is loading, then exactly once when it has loaded', async () => {
    mockCloset.status = 'loading';
    mockCloset.garments = [];
    mockedFetch.mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);

    expect(screen.getByLabelText("Finding today's outfit…")).toBeOnTheScreen();
    expect(mockedFetch).not.toHaveBeenCalled();

    mockCloset.status = 'ready';
    mockCloset.garments = CLOSET;
    await view.rerender(<TodayScreen />);

    expect(await screen.findByText('Jeans · Blue')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  test('three quick closet changes make one refetch, after the debounce', async () => {
    jest.useFakeTimers();
    mockedFetch.mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    for (const [index, name] of ['gray', 'black', 'red'].entries()) {
      mockCloset.garments = [...CLOSET, garment({ id: `new-${String(index)}`, category: 'shirt', colors: [name as 'gray'] })];
      await view.rerender(<TodayScreen />);
      await advance(1_000);
    }
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await advance(CLOSET_REFETCH_DELAY_MS);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  test('an upload still being read (no category yet) does not refetch', async () => {
    jest.useFakeTimers();
    mockedFetch.mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    mockCloset.garments = [...CLOSET, garment({ id: 'uploading', category: null })];
    await view.rerender(<TodayScreen />);
    await advance(CLOSET_REFETCH_DELAY_MS * 2);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  test('a closet change while a fetch is in flight makes one follow-up fetch, never two at once', async () => {
    jest.useFakeTimers();
    const first = deferred(list());
    mockedFetch.mockReturnValueOnce(first.promise).mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    mockCloset.garments = CLOSET.map((g) => (g.id === SKIRT ? { ...g, colors: ['black'] } : g));
    await view.rerender(<TodayScreen />);
    await advance(CLOSET_REFETCH_DELAY_MS);
    // The debounced refetch waits for the request in flight.
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // So does the occasion change.
    await fireEvent.press(screen.getByRole('radio', { name: 'Office' }));
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
      await Promise.resolve();
    });
    await screen.findByText('Jeans · Blue');
    // One follow-up, with the latest inputs.
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch).toHaveBeenLastCalledWith({ occasion: 'office', date: '2026-11-08' });
  });

  test('when every outfit is filtered out and a refetch fails, Today shows the error, not the empty message', async () => {
    jest.useFakeTimers();
    mockedFetch.mockReturnValue(ok(list([FIRST])));
    const view = await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    mockedFetch.mockResolvedValue({ ok: false, error: 'network' });
    mockCloset.garments = CLOSET.map((g) => (g.id === JEANS ? { ...g, status: 'laundry' } : g));
    await view.rerender(<TodayScreen />);
    await advance(CLOSET_REFETCH_DELAY_MS);

    expect(await screen.findByText("Couldn't reach the AI. Check your internet and try again.")).toBeOnTheScreen();
    expect(screen.queryByText('No outfit came up today. Add a few more pieces to your closet.')).toBeNull();
  });

  test("a late result for an older occasion never replaces the current occasion's settled list", async () => {
    mockedFetch.mockReturnValueOnce(ok(list([FIRST])));
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    // Office, then straight back: the Office request is in flight when "no occasion" settles again.
    const office = deferred(list([SECOND]));
    const again = deferred(list([FIRST]));
    mockedFetch.mockReturnValueOnce(office.promise).mockReturnValueOnce(again.promise);
    await fireEvent.press(screen.getByRole('radio', { name: 'Office' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Office' }));
    await act(async () => {
      office.resolve();
      await Promise.resolve();
    });

    // The no-occasion list stays on screen while its own refetch is still on the way.
    expect(screen.getByText('Jeans · Blue')).toBeOnTheScreen();
    expect(screen.queryByText('Skirt · Camel')).toBeNull();
  });

  test('a pending debounce timer is cancelled when another trigger fetches the same fingerprint', async () => {
    jest.useFakeTimers();
    mockedFetch.mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    mockCloset.garments = CLOSET.map((g) => (g.id === SKIRT ? { ...g, colors: ['black'] } : g));
    await view.rerender(<TodayScreen />);
    // The occasion change fetches at once, with the new closet.
    await fireEvent.press(screen.getByRole('radio', { name: 'Office' }));
    expect(mockedFetch).toHaveBeenCalledTimes(2);

    await advance(CLOSET_REFETCH_DELAY_MS);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  test("a queued follow-up fetch doesn't run after blur", async () => {
    const first = deferred(list());
    mockedFetch.mockReturnValueOnce(first.promise).mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Office' }));

    mockFocus.focused = false;
    await view.rerender(<TodayScreen />);
    await act(async () => {
      first.resolve();
      await Promise.resolve();
    });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  test('a new wear count alone does not refetch', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);
    await screen.findByText('9 wears');

    mockCloset.garments = CLOSET.map((g) => (g.id === TOP ? { ...g, wear_count: 10 } : g));
    await view.rerender(<TodayScreen />);

    expect(await screen.findByText('10 wears')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  test('coming back to the screen refetches and keeps the outfit on screen', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');
    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));

    mockFocus.focused = false;
    await view.rerender(<TodayScreen />);
    mockFocus.focused = true;
    await view.rerender(<TodayScreen />);

    expect(await screen.findByText('Skirt · Camel')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  test('returning to the foreground on a new day fetches that day', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    const dates = jest.requireMock<{ localDate: () => string }>('../lib/localDate');
    const original = dates.localDate;
    dates.localDate = () => '2026-11-09';
    try {
      await act(async () => {
        for (const listener of appStateListeners) listener('active');
        await Promise.resolve();
      });
      expect(mockedFetch).toHaveBeenLastCalledWith({ occasion: null, date: '2026-11-09' });
    } finally {
      dates.localDate = original;
    }
  });
});

describe("I'll wear it", () => {
  test('Undo shows after the wear and brings "I\'ll wear it" back', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedLogWear.mockResolvedValue({ ok: true });
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Undo' }));

    expect(await screen.findByRole('button', { name: "I'll wear it" })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  test('a failed undo says so and keeps Undo for a retry', async () => {
    const { deleteWear } = jest.requireMock<{ deleteWear: jest.Mock }>('../stats/wearsRepository');
    deleteWear.mockResolvedValueOnce({ ok: false, error: 'network' });
    mockedFetch.mockReturnValue(ok(list()));
    mockedLogWear.mockResolvedValue({ ok: true });
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Undo' }));

    expect(await screen.findByText("Couldn't undo. You can delete it from your Diary.")).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeOnTheScreen();
  });

  test('logs the wear once on a double tap, then shows Logged ✓ and refreshes the closet', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    let resolveWear: (value: { ok: true }) => void = () => undefined;
    mockedLogWear.mockReturnValue(
      new Promise((resolve) => {
        resolveWear = resolve;
      }),
    );
    await render(<TodayScreen />);

    const wear = await screen.findByRole('button', { name: "I'll wear it" });
    await fireEvent.press(wear);
    await fireEvent.press(wear);
    expect(mockedLogWear).toHaveBeenCalledTimes(1);
    expect(mockedLogWear).toHaveBeenCalledWith({
      wearId: 'wear-1',
      garmentIds: FIRST.garmentIds,
      wornOn: '2026-11-08',
      occasion: null,
      // The outfit's Jev score, so Stats' average and the diary show it.
      score: 88,
    });
    expect(screen.getByRole('button', { name: "I'll wear it" })).toBeDisabled();

    await act(async () => {
      resolveWear({ ok: true });
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: 'Logged ✓' })).toBeDisabled();
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    // Logged belongs to that outfit: the next one can be worn.
    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));
    expect(screen.getByRole('button', { name: "I'll wear it" })).toBeEnabled();
  });

  test('offline, I\'ll wear it shows Logged and the queued note', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedLogWear.mockResolvedValueOnce({ ok: false, error: 'network' });
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
    expect(await screen.findByRole('button', { name: 'Logged ✓' })).toBeDisabled();
    expect(screen.getByText("Logged — it syncs when you're back online.")).toBeOnTheScreen();
    expect(queuedWears('user-1').map((w) => [w.wearId, w.score])).toEqual([['wear-1', 88]]);
    expect(mockedLogWear).toHaveBeenCalledTimes(1);
  });

  test('the queued note goes once the wear has been sent', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedLogWear.mockResolvedValueOnce({ ok: false, error: 'network' });
    const view = await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
    expect(await screen.findByText("Logged — it syncs when you're back online.")).toBeOnTheScreen();

    // The flusher sent it and refreshed the closet, which re-renders Today.
    dequeueWear('user-1', 'wear-1');
    await view.rerender(<TodayScreen />);

    expect(screen.queryByText("Logged — it syncs when you're back online.")).toBeNull();
    expect(screen.getByRole('button', { name: 'Logged ✓' })).toBeOnTheScreen();
  });

  test('another error shows the message and the button works again with the same wear id', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedLogWear.mockResolvedValueOnce({ ok: false, error: 'unknown' }).mockResolvedValueOnce({ ok: true });
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: "I'll wear it" })).toBeEnabled();

    await fireEvent.press(screen.getByRole('button', { name: "I'll wear it" }));
    expect(await screen.findByRole('button', { name: 'Logged ✓' })).toBeOnTheScreen();
    expect(mockedLogWear.mock.calls.map(([input]) => input.wearId)).toEqual(['wear-1', 'wear-1']);
    expect(queuedWears('user-1')).toEqual([]);
  });

  test("a lost wear for one outfit keeps its id after trying another one", async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedLogWear
      .mockResolvedValueOnce({ ok: false, error: 'unknown' })
      .mockResolvedValueOnce({ ok: false, error: 'unknown' })
      .mockResolvedValueOnce({ ok: true });
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
    await screen.findByText('Something went wrong. Try again.');
    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));
    await fireEvent.press(screen.getByRole('button', { name: "I'll wear it" }));
    await screen.findByText('Something went wrong. Try again.');
    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));
    await fireEvent.press(screen.getByRole('button', { name: "I'll wear it" }));

    expect(await screen.findByRole('button', { name: 'Logged ✓' })).toBeOnTheScreen();
    expect(mockedLogWear.mock.calls.map(([input]) => [input.wearId, input.garmentIds])).toEqual([
      ['wear-1', FIRST.garmentIds],
      ['wear-2', SECOND.garmentIds],
      ['wear-1', FIRST.garmentIds],
    ]);
  });

  test('passes the chosen occasion to the wear', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedLogWear.mockResolvedValue({ ok: true });
    await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Office' }));

    await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
    expect(mockedLogWear).toHaveBeenCalledWith(expect.objectContaining({ occasion: 'office' }));
  });
});

describe('Not for me', () => {
  const mockedDismiss = jest.mocked(dismissOutfit);
  const mockedStopSuggesting = jest.mocked(stopSuggesting);

  const mockedUndismiss = jest.mocked(undismissOutfit);
  const THIRD: LuckyOutfit = { garmentIds: [TOP, JEANS, SNEAKERS], score: 76, freshThisWeek: false };
  const FOURTH: LuckyOutfit = { garmentIds: [TOP, SKIRT, SNEAKERS, BAG], score: 70, freshThisWeek: false };

  beforeEach(() => {
    kvRemove(storedDismissedKey('user-1'));
    mockedUndismiss.mockReset();
    mockedDismiss.mockReset();
    mockedStopSuggesting.mockReset();
    mockReplaceLocal.mockClear();
  });

  test("offers the combination or one of its pieces, and Cancel closes it", async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    await fireEvent.press(screen.getByRole('button', { name: 'Not for me' }));

    expect(screen.getByRole('button', { name: "Don't suggest this combination" })).toBeOnTheScreen();
    for (const piece of ['Blouse · White', 'Jeans · Blue', 'Sneakers · White', 'Bag · Brown']) {
      expect(screen.getByRole('button', { name: `Don't suggest ${piece}` })).toBeOnTheScreen();
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: "Don't suggest this combination" })).toBeNull();
    expect(mockedDismiss).not.toHaveBeenCalled();
  });

  test("Don't suggest this combination dismisses it, shows the next outfit, and refetches when fewer than 3 are left", async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedDismiss.mockResolvedValue({ ok: true });
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    await fireEvent.press(screen.getByRole('button', { name: 'Not for me' }));
    await fireEvent.press(screen.getByRole('button', { name: "Don't suggest this combination" }));

    expect(mockedDismiss).toHaveBeenCalledWith(FIRST.garmentIds);
    expect(await screen.findByText('Skirt · Camel')).toBeOnTheScreen();
    expect(screen.queryByText('Jeans · Blue')).toBeNull();
    expect(screen.getByText("This combination won't be suggested again.")).toBeOnTheScreen();
    // The one left can't be swapped for another.
    expect(screen.getByRole('button', { name: 'Another' })).toBeDisabled();

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Skirt · Camel')).toBeOnTheScreen();
  });

  test('with 3 or more left, a dismissal refetches nothing, even after the debounce', async () => {
    jest.useFakeTimers();
    mockedFetch.mockReturnValue(ok(list([FIRST, SECOND, THIRD, FOURTH])));
    mockedDismiss.mockResolvedValue({ ok: true });
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    await fireEvent.press(screen.getByRole('button', { name: 'Not for me' }));
    await fireEvent.press(screen.getByRole('button', { name: "Don't suggest this combination" }));
    await advance(CLOSET_REFETCH_DELAY_MS);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Skirt · Camel')).toBeOnTheScreen();
  });

  test('a dismissal survives a restart: the stored list never shows it again', async () => {
    mockedFetch.mockReturnValue(ok(list([FIRST, SECOND, THIRD, FOURTH])));
    mockedDismiss.mockResolvedValue({ ok: true });
    const first = await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');
    await fireEvent.press(screen.getByRole('button', { name: 'Not for me' }));
    await fireEvent.press(screen.getByRole('button', { name: "Don't suggest this combination" }));
    await first.unmount();

    expect(kvGet(storedDismissedKey('user-1'))).toContain([...FIRST.garmentIds].sort().join(','));
    await render(<TodayScreen />);
    expect(await screen.findByText('Skirt · Camel')).toBeOnTheScreen();
    expect(screen.queryByTestId(`outfit-piece-${BAG}`)).toBeNull();
  });

  test('Undo right after a dismissal brings the combination back', async () => {
    mockedFetch.mockReturnValue(ok(list([FIRST, SECOND, THIRD, FOURTH])));
    mockedDismiss.mockResolvedValue({ ok: true });
    mockedUndismiss.mockResolvedValue({ ok: true });
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');
    await fireEvent.press(screen.getByRole('button', { name: 'Not for me' }));
    await fireEvent.press(screen.getByRole('button', { name: "Don't suggest this combination" }));

    await fireEvent.press(await screen.findByRole('button', { name: 'Undo' }));

    expect(mockedUndismiss).toHaveBeenCalledWith(FIRST.garmentIds);
    expect(kvGet(storedDismissedKey('user-1')) ?? '').not.toContain([...FIRST.garmentIds].sort().join(','));
    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));
    expect(screen.getByTestId(`outfit-piece-${BAG}`)).toBeOnTheScreen();
  });

  test('a closet row cached by an older build (no suggest field) still shows its outfits', async () => {
    mockCloset.garments = CLOSET.map((g) => ({ ...g, suggest: undefined }) as unknown as Garment);
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    expect(await screen.findByText('Jeans · Blue')).toBeOnTheScreen();
  });

  test("Don't suggest a piece turns it off, hides its outfits and shows the next", async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedStopSuggesting.mockResolvedValue({ ok: true });
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    await fireEvent.press(screen.getByRole('button', { name: 'Not for me' }));
    await fireEvent.press(screen.getByRole('button', { name: "Don't suggest Jeans · Blue" }));

    expect(mockedStopSuggesting).toHaveBeenCalledWith(JEANS);
    expect(mockReplaceLocal).toHaveBeenCalledWith({ ...CLOSET[1], suggest: false });
    expect(await screen.findByText('Skirt · Camel')).toBeOnTheScreen();
    expect(screen.getByText("Jeans · Blue won't be suggested. It can be turned back on in its details.")).toBeOnTheScreen();
    expect(mockedDismiss).not.toHaveBeenCalled();
  });

  test('a failed dismissal says why and keeps the outfit', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedDismiss.mockResolvedValue({ ok: false, error: 'network' });
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    await fireEvent.press(screen.getByRole('button', { name: 'Not for me' }));
    await fireEvent.press(screen.getByRole('button', { name: "Don't suggest this combination" }));

    expect(await screen.findByText("Couldn't save that. Check your internet and try again.")).toBeOnTheScreen();
    expect(screen.getByTestId(`outfit-piece-${JEANS}`)).toBeOnTheScreen();
  });

  test('a garment taken out of suggestions elsewhere hides its outfits at once and refetches after the debounce', async () => {
    jest.useFakeTimers();
    mockedFetch.mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    mockCloset.garments = CLOSET.map((g) => (g.id === JEANS ? { ...g, suggest: false } : g));
    await view.rerender(<TodayScreen />);

    expect(screen.getByText('Skirt · Camel')).toBeOnTheScreen();
    expect(screen.queryByText('Jeans · Blue')).toBeNull();
    await advance(CLOSET_REFETCH_DELAY_MS);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});

describe('other states', () => {
  test('too_small names the missing pieces, offers the closet and no outfit buttons', async () => {
    mockedFetch.mockReturnValue(ok({ kind: 'too_small', missing: ['shoes'], weather: SUNNY }));
    await render(<TodayScreen />);

    expect(await screen.findByText('Add 1 more to get outfits: shoes')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: "I'll wear it" })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Another' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Go to your closet' }));
    expect(mockedPush).toHaveBeenCalledWith('/closet');
  });

  test('without weather the header asks for a city and opens the city modal', async () => {
    mockedFetch.mockReturnValue(ok(list(undefined, null)));
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Sunday · Add your city for the weather' }));
    expect(mockedPush).toHaveBeenCalledWith('/city');
  });

  test('a city that gave no weather says so, and tapping it opens the city modal', async () => {
    mockedFetch.mockReturnValue(ok(list(undefined, null)));
    mockAuth.profile = { city_name: 'Atlantis' };
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Sunday · Weather unavailable for Atlantis' }));
    expect(mockedPush).toHaveBeenCalledWith('/city');
    expect(screen.queryByText('Add your city for the weather')).toBeNull();
  });

  test('the header shows the weekday while the weather is still unknown', async () => {
    mockedFetch.mockReturnValue(new Promise(() => undefined));
    await render(<TodayScreen />);

    expect(await screen.findByText('Sunday')).toBeOnTheScreen();
  });

  test('with weather the profile is not read', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    await screen.findByText(/24 °C, sunny/);
    expect(mockedGetProfile).not.toHaveBeenCalled();
  });

  test('tapping the weather line opens the city modal', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    const line = await screen.findByRole('button', { name: /24 °C, sunny/ });
    // One short text row, topped up to a 44 pt tap target.
    expect(line).toHaveProp('hitSlop', expect.objectContaining({ top: 13, bottom: 13 }));
    await fireEvent.press(line);
    expect(mockedPush).toHaveBeenCalledWith('/city');
  });

  test('a network error shows its message and a retry that fetches again', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: false, error: 'network' }).mockReturnValueOnce(ok(list()));
    await render(<TodayScreen />);

    expect(await screen.findByText("Couldn't reach the AI. Check your internet and try again.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Jeans · Blue')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  test('over quota says when it renews and offers Build instead of a retry', async () => {
    mockedFetch.mockResolvedValue({ ok: false, error: 'over_quota' });
    await render(<TodayScreen />);

    expect(await screen.findByText("You've used today's outfit suggestions. Try again tomorrow.")).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Build your own' }));
    expect(mockedPush).toHaveBeenCalledWith('/build');
  });

  test.each([
    ['not_found', 'Some pieces are no longer in your closet.'],
    ['incomplete', 'Your closet is missing a piece for an outfit.'],
  ] as const)('%s offers the closet instead of a retry that would fail again', async (error, message) => {
    mockedFetch.mockResolvedValue({ ok: false, error });
    await render(<TodayScreen />);

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Go to your closet' }));
    expect(mockedPush).toHaveBeenCalledWith('/closet');
  });

  test('a long wait says so in stages', async () => {
    jest.useFakeTimers();
    mockedFetch.mockReturnValue(new Promise(() => undefined));
    await render(<TodayScreen />);

    expect(screen.queryByText('Still thinking…')).toBeNull();
    await advance(6000);
    expect(screen.getByText('Still thinking…')).toBeOnTheScreen();
    expect(screen.getByLabelText('Still thinking…')).toBeOnTheScreen();
    await advance(14000);
    expect(screen.getByText('Almost there…')).toBeOnTheScreen();
  });

  test('an empty list says so instead of showing an empty card', async () => {
    mockedFetch.mockReturnValue(ok(list([])));
    await render(<TodayScreen />);

    expect(await screen.findByText('No outfit came up today. Add a few more pieces to your closet.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: "I'll wear it" })).toBeNull();
  });

  test('shows a loading card while the list is on its way', async () => {
    mockedFetch.mockReturnValue(new Promise(() => undefined));
    await render(<TodayScreen />);

    expect(screen.getByLabelText("Finding today's outfit…")).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: "I'll wear it" })).toBeNull();
  });
});

describe('navigation', () => {
  test('"How does it look?" pushes the rate screen with the outfit ids', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'How does it look?' }));
    expect(mockedPush).toHaveBeenCalledWith({ pathname: '/rate', params: { ids: FIRST.garmentIds.join(',') } });
  });

  test('"How does it look?" passes the occasion when one is chosen', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Office' }));

    await fireEvent.press(await screen.findByRole('button', { name: 'How does it look?' }));
    expect(mockedPush).toHaveBeenCalledWith({
      pathname: '/rate',
      params: { ids: FIRST.garmentIds.join(','), occasion: 'office' },
    });
  });
});

describe('offline', () => {
  const OFFLINE_NOTE = 'Offline — showing your last suggestions';

  test("a cold start shows today's stored list at once, and the note when the fetch can't connect", async () => {
    storeLucky('user-1', '2026-11-08', null, list([SECOND, FIRST]));
    let fail: () => void = () => undefined;
    mockedFetch.mockReturnValue(
      new Promise((resolve) => {
        fail = () => {
          resolve({ ok: false, error: 'network' });
        };
      }),
    );
    await render(<TodayScreen />);

    // Shown while the fetch runs, with its weather, and no note yet.
    expect(screen.getByText('Skirt · Camel')).toBeOnTheScreen();
    expect(screen.getByText(/24 °C, sunny/)).toBeOnTheScreen();
    expect(screen.queryByLabelText("Finding today's outfit…")).toBeNull();
    expect(screen.queryByText(OFFLINE_NOTE)).toBeNull();

    await act(async () => {
      fail();
      await Promise.resolve();
    });
    expect(await screen.findByText(OFFLINE_NOTE)).toBeOnTheScreen();
    expect(screen.getByText('Skirt · Camel')).toBeOnTheScreen();
    expect(screen.queryByText("Couldn't reach the AI. Check your internet and try again.")).toBeNull();
    expect(screen.getByRole('button', { name: "I'll wear it" })).toBeEnabled();
  });

  test('a successful fetch replaces the stored list and is stored for the next start', async () => {
    storeLucky('user-1', '2026-11-08', null, list([SECOND]));
    mockedFetch.mockReturnValue(ok(list([FIRST])));
    const first = await render(<TodayScreen />);

    expect(await screen.findByText('Jeans · Blue')).toBeOnTheScreen();
    expect(screen.queryByText('Skirt · Camel')).toBeNull();
    expect(screen.queryByText(OFFLINE_NOTE)).toBeNull();
    await first.unmount();

    mockedFetch.mockResolvedValue({ ok: false, error: 'network' });
    await render(<TodayScreen />);
    expect(screen.getByText('Jeans · Blue')).toBeOnTheScreen();
    expect(await screen.findByText(OFFLINE_NOTE)).toBeOnTheScreen();
  });

  test('a failed refetch in the same session keeps the list and shows the note', async () => {
    mockedFetch.mockReturnValueOnce(ok(list())).mockResolvedValue({ ok: false, error: 'network' });
    const view = await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    mockFocus.focused = false;
    await view.rerender(<TodayScreen />);
    mockFocus.focused = true;
    await view.rerender(<TodayScreen />);

    expect(await screen.findByText(OFFLINE_NOTE)).toBeOnTheScreen();
    expect(screen.getByText('Jeans · Blue')).toBeOnTheScreen();
  });

  test('the note wraps beside its icon at a large text size instead of running off the screen', async () => {
    mockedFetch.mockResolvedValue({ ok: false, error: 'network' });
    storeLucky('user-1', '2026-11-08', null, list());
    await render(<TodayScreen />);
    expect(await screen.findByText(OFFLINE_NOTE)).toHaveStyle({ flexShrink: 1 });
  });

  test('a stored too_small answer is shown offline too', async () => {
    storeLucky('user-1', '2026-11-08', null, { kind: 'too_small', missing: ['shoes'], weather: null });
    mockedFetch.mockResolvedValue({ ok: false, error: 'network' });
    await render(<TodayScreen />);

    expect(await screen.findByText(OFFLINE_NOTE)).toBeOnTheScreen();
    expect(screen.getByText('Add 1 more to get outfits: shoes')).toBeOnTheScreen();
  });

  test("another day's, occasion's or user's stored list isn't shown", async () => {
    storeLucky('user-1', '2026-11-07', null, list());
    storeLucky('user-1', '2026-11-08', 'office', list());
    storeLucky('user-2', '2026-11-08', null, list());
    mockedFetch.mockResolvedValue({ ok: false, error: 'network' });
    await render(<TodayScreen />);

    expect(await screen.findByText("Couldn't reach the AI. Check your internet and try again.")).toBeOnTheScreen();
    expect(screen.queryByText('Jeans · Blue')).toBeNull();
    expect(screen.queryByText(OFFLINE_NOTE)).toBeNull();
  });

  test('a stored list waits for the closet to load', async () => {
    storeLucky('user-1', '2026-11-08', null, list());
    mockCloset.status = 'loading';
    mockCloset.garments = [];
    mockedFetch.mockReturnValue(new Promise(() => undefined));
    const view = await render(<TodayScreen />);

    expect(screen.getByLabelText("Finding today's outfit…")).toBeOnTheScreen();

    mockCloset.status = 'offline';
    mockCloset.garments = CLOSET;
    await view.rerender(<TodayScreen />);
    expect(await screen.findByText('Jeans · Blue')).toBeOnTheScreen();
  });

  test('another error than the network keeps the stored list without the offline note', async () => {
    storeLucky('user-1', '2026-11-08', null, list());
    mockedFetch.mockResolvedValue({ ok: false, error: 'unavailable' });
    await render(<TodayScreen />);

    expect(await screen.findByText('Jeans · Blue')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(OFFLINE_NOTE)).toBeNull();
    expect(screen.queryByText("The AI can't suggest outfits right now. Try again in a moment.")).toBeNull();
  });
});


describe("sharing Today's outfit as an image", () => {
  beforeEach(() => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
    jest.mocked(Sharing.shareAsync).mockReset();
    jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
  });

  test("Share on the card shows the outfit's card with its score and shares the PNG", async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Share' }));

    const card = screen.getByTestId('share-card');
    expect(within(card).getAllByTestId(/^share-piece-/)).toHaveLength(4);
    expect(within(card).getByText('88')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Share image' }));

    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/outfit.png', expect.objectContaining({ mimeType: 'image/png' }));
  });

  test('a failed share shows a message instead of crashing, and Close dismisses the sheet', async () => {
    jest.mocked(Sharing.shareAsync).mockRejectedValue(new Error('sheet failed'));
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Share' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Share image' }));

    expect(await screen.findByText("Couldn't create the image. Try again.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('share-card')).not.toBeOnTheScreen();
  });

  test("a device that can't share says so", async () => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Share' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Share image' }));

    expect(await screen.findByText("Sharing isn't available on this device.")).toBeOnTheScreen();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});

describe("listening to Today's outfit", () => {
  const SPOKEN = 'Blouse, White. Jeans, Blue. Sneakers, White. Bag, Brown. Sunday, 24 °C, sunny.';

  beforeEach(() => {
    jest.mocked(Speech.speak).mockClear();
    jest.mocked(Speech.stop).mockClear();
    kvRemove('locale-preference');
  });

  test('Listen reads the pieces, the weather line and the occasion with an English voice', async () => {
    kvSet(KV_KEY, 'office');
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Listen' }));

    expect(Speech.speak).toHaveBeenCalledWith(
      `${SPOKEN} Occasion: Office.`,
      expect.objectContaining({ language: 'en-US', voice: 'voice-en-us' }),
    );
    expect(screen.getByRole('button', { name: 'Stop' })).toBeOnTheScreen();
  });

  test('a second tap stops it', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Listen' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Stop' }));

    expect(Speech.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Listen' })).toBeOnTheScreen();
  });

  test('the button resets when the speech ends by itself', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Listen' }));

    await act(() => {
      jest.mocked(Speech.speak).mock.calls[0]?.[1]?.onDone?.();
    });

    expect(screen.getByRole('button', { name: 'Listen' })).toBeOnTheScreen();
  });

  test('leaving the screen stops it', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    const view = await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Listen' }));

    mockFocus.focused = false;
    await view.rerender(<TodayScreen />);

    expect(Speech.stop).toHaveBeenCalled();
  });

  test('"Another" stops the outfit being read', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Listen' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));

    expect(Speech.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Listen' })).toBeOnTheScreen();
  });

  test('in Spanish, with a Latin American voice', async () => {
    kvSet('locale-preference', 'es');
    mockedFetch.mockReturnValue(ok(list()));
    await render(
      <I18nProvider>
        <TodayScreen />
      </I18nProvider>,
    );

    await fireEvent.press(await screen.findByRole('button', { name: 'Escuchar' }));

    expect(Speech.speak).toHaveBeenCalledWith(
      expect.stringContaining('Blusa, Blanco.'),
      expect.objectContaining({ language: 'es-MX', voice: 'voice-es-mx' }),
    );
  });

  test('hidden when the phone lists voices but none in the app language', async () => {
    jest.mocked(Speech.getAvailableVoicesAsync).mockResolvedValueOnce([
      { identifier: 'voice-fr', name: 'Thomas', language: 'fr-FR', quality: Speech.VoiceQuality.Default },
    ]);
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    await screen.findByRole('button', { name: 'Share' });
    expect(screen.queryByRole('button', { name: 'Listen' })).not.toBeOnTheScreen();
  });

  test('a speech error says so', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Listen' }));

    await act(() => {
      jest.mocked(Speech.speak).mock.calls[0]?.[1]?.onError?.(new Error('no engine'));
    });

    expect(alert).toHaveBeenCalledWith("This phone has no voice for this language.");
    expect(screen.getByRole('button', { name: 'Listen' })).toBeOnTheScreen();
  });
});

describe('saying the occasion', () => {
  beforeEach(() => {
    recognition.start.mockClear();
    kvRemove('locale-preference');
  });

  test('"Say the occasion" maps the spoken words to an occasion chip', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Say the occasion' }));
    expect(recognition.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en-US' }));

    await act(() => {
      hear('a meeting at work');
    });

    expect(screen.getByRole('radio', { name: 'Office' })).toBeSelected();
    expect(kvGet(KV_KEY)).toBe('office');
  });

  test('in Spanish, "fiesta" picks Going out', async () => {
    kvSet('locale-preference', 'es');
    mockedFetch.mockReturnValue(ok(list()));
    await render(
      <I18nProvider>
        <TodayScreen />
      </I18nProvider>,
    );

    await fireEvent.press(await screen.findByRole('button', { name: 'Decir la ocasión' }));
    expect(recognition.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'es-MX' }));
    await act(() => {
      hear('me voy de fiesta');
    });

    expect(screen.getByRole('radio', { name: 'Salidas' })).toBeSelected();
  });

  test("words that match no occasion say they weren't caught and keep the chips", async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Say the occasion' }));
    await act(() => {
      hear('banana');
    });

    expect(screen.getByText('Didn\'t catch that. Try "work", "party" or "gym".')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Office' })).not.toBeSelected();
  });
});

describe('the voice features together', () => {
  beforeEach(() => {
    recognition.start.mockClear();
    jest.mocked(Speech.speak).mockClear();
    jest.mocked(Speech.stop).mockClear();
    kvRemove('locale-preference');
  });

  test("dictating stops Listen first, so the recognizer doesn't hear the app", async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Listen' }));
    jest.mocked(Speech.stop).mockClear();

    await fireEvent.press(screen.getByRole('button', { name: 'Say the occasion' }));

    expect(Speech.stop).toHaveBeenCalled();
    expect(recognition.start).toHaveBeenCalled();
    expect(jest.mocked(Speech.stop).mock.invocationCallOrder[0]).toBeLessThan(
      recognition.start.mock.invocationCallOrder[0] ?? 0,
    );
    expect(screen.getByRole('button', { name: 'Listen' })).toBeOnTheScreen();
  });

  test("a late stop from an earlier utterance doesn't reset the one playing now", async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Listen' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Stop' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Listen' }));

    await act(() => {
      jest.mocked(Speech.speak).mock.calls[0]?.[1]?.onStopped?.();
    });

    expect(screen.getByRole('button', { name: 'Stop' })).toBeOnTheScreen();
  });

  test('a denied microphone for the occasion offers Open settings', async () => {
    recognition.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied', expires: 'never' });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Say the occasion' }));

    expect(
      await screen.findByText('Microphone access is off for Dressing Room. Turn it on in Settings to dictate.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('link', { name: 'Open settings' }));
    expect(openSettings).toHaveBeenCalled();
  });
});

describe('Planned for today', () => {
  const PLAN: PlannedOutfit = { id: 'p-1', day: '2026-11-08', garmentIds: [TOP, SKIRT, SNEAKERS], occasion: 'going_out' };

  test('a plan for today shows first, and nothing is logged until its "I\'ll wear it"', async () => {
    mockedListPlans.mockResolvedValue([PLAN]);
    mockedFetch.mockReturnValue(ok(list()));
    mockedLogWear.mockResolvedValue({ ok: true });
    await render(<TodayScreen />);

    const card = await screen.findByTestId('planned-today');
    expect(within(card).getByText('Planned for today')).toBeOnTheScreen();
    expect(within(card).getByText('Skirt · Camel')).toBeOnTheScreen();
    expect(mockedListPlans).toHaveBeenCalledWith('2026-11-08', '2026-11-21');
    expect(mockedLogWear).not.toHaveBeenCalled();

    await fireEvent.press(within(card).getByRole('button', { name: "I'll wear it" }));

    expect(mockedLogWear).toHaveBeenCalledWith({
      wearId: 'wear-1',
      garmentIds: [TOP, SKIRT, SNEAKERS],
      wornOn: '2026-11-08',
      occasion: 'going_out',
      score: null,
    });
    expect(await within(card).findByRole('button', { name: 'Logged ✓' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Undo' })).toBeOnTheScreen();
  });

  test('the stored plan shows at once, before the refresh answers', async () => {
    kvSet(plansKey('user-1'), JSON.stringify([PLAN]));
    mockedListPlans.mockReturnValue(new Promise<never>(() => undefined));
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);

    expect(await screen.findByTestId('planned-today')).toBeOnTheScreen();
  });

  test('a planned piece that is gone or in the laundry is left out; without a complete outfit it can’t be worn', async () => {
    mockedListPlans.mockResolvedValue([{ ...PLAN, garmentIds: [TOP, JEANS, SNEAKERS, '00000000-0000-4000-8000-0000000000ff'] }]);
    mockCloset.garments = CLOSET.map((g) => (g.id === JEANS ? { ...g, status: 'laundry' } : g));
    mockedFetch.mockReturnValue(ok(list([SECOND])));
    await render(<TodayScreen />);

    const card = await screen.findByTestId('planned-today');
    expect(within(card).queryByText('Jeans · Blue')).toBeNull();
    expect(within(card).getByText("Some pieces aren't available")).toBeOnTheScreen();
    expect(within(card).getByRole('button', { name: "I'll wear it" })).toBeDisabled();
  });

  test('a plan for another day shows no card', async () => {
    mockedListPlans.mockResolvedValue([{ ...PLAN, day: '2026-11-09' }]);
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    expect(screen.queryByTestId('planned-today')).toBeNull();
  });

  test('"Plan ahead" opens the planner', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    await render(<TodayScreen />);
    await screen.findByText('Jeans · Blue');

    await fireEvent.press(screen.getByRole('button', { name: 'Plan ahead' }));
    expect(mockedPush).toHaveBeenLastCalledWith('/plan');
  });
});
