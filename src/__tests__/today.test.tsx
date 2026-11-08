// The Today tab (mockup 01 screen 1): the weather line, occasion chips, the "feeling lucky" card,
// "Another" and "I'll wear it". Rendered directly with the closet, auth, the AI client and the
// outfit repository mocked.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { AppState, type AppStateStatus } from 'react-native';

import TodayScreen from '../app/(tabs)/index';
import type { Garment } from '../closet/garmentRepository';
import { kvGet, kvRemove } from '../lib/kv';
import { fetchLuckyList, type AiOutcome } from '../outfits/aiClient';
import { logWear } from '../outfits/outfitRepository';
import { CLOSET_REFETCH_DELAY_MS } from '../outfits/useLuckyList';
import { getProfile, type Profile } from '../profile/profileRepository';
import type { LuckyOutfit, LuckyResponse, WeatherSummary } from '../outfits/types';
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

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'user-1' }),
}));

const mockCloset: { garments: Garment[]; status: 'loading' | 'ready' | 'offline' } = { garments: [], status: 'ready' };
const mockRefresh = jest.fn(() => Promise.resolve());
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockCloset.garments,
    thumbUrls: new Map<string, string>(),
    status: mockCloset.status,
    refresh: mockRefresh,
    replaceLocal: jest.fn(),
    removeLocal: jest.fn(),
  }),
}));

jest.mock('../outfits/aiClient', () => ({
  fetchLuckyList: jest.fn(),
  localDate: () => '2026-11-08',
}));

jest.mock('../outfits/outfitRepository', () => ({
  logWear: jest.fn(),
}));

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

jest.mock('../profile/profileRepository', () => ({ getProfile: jest.fn() }));

const mockedFetch = jest.mocked(fetchLuckyList);
const mockedLogWear = jest.mocked(logWear);
const mockedUuid = jest.mocked(randomUUID);
const mockedPush = jest.mocked(router.push);
const mockedGetProfile = jest.mocked(getProfile);

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
  mockFocus.focused = true;
  mockCloset.garments = CLOSET;
  mockCloset.status = 'ready';
  mockedFetch.mockReset();
  mockedLogWear.mockReset();
  mockedUuid.mockReset();
  mockedUuid.mockReturnValueOnce('wear-1').mockReturnValueOnce('wear-2');
  mockedPush.mockClear();
  mockRefresh.mockClear();
  mockedGetProfile.mockReset();
  mockedGetProfile.mockResolvedValue({ city_name: null } as Profile);
  kvRemove(KV_KEY);
  kvRemove('outfit.worn.user-1');
  kvRemove('today.lucky.user-1');
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

    const aiClient = jest.requireMock<{ localDate: () => string }>('../outfits/aiClient');
    const original = aiClient.localDate;
    aiClient.localDate = () => '2026-11-09';
    try {
      await act(async () => {
        for (const listener of appStateListeners) listener('active');
        await Promise.resolve();
      });
      expect(mockedFetch).toHaveBeenLastCalledWith({ occasion: null, date: '2026-11-09' });
    } finally {
      aiClient.localDate = original;
    }
  });
});

describe("I'll wear it", () => {
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
      score: null,
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

  test('a network error shows the message in the notice and the button works again with the same wear id', async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedLogWear.mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: true });
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
    expect(await screen.findByText("Couldn't connect. Check your internet and try again.")).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: "I'll wear it" })).toBeEnabled();

    await fireEvent.press(screen.getByRole('button', { name: "I'll wear it" }));
    expect(await screen.findByRole('button', { name: 'Logged ✓' })).toBeOnTheScreen();
    expect(mockedLogWear.mock.calls.map(([input]) => input.wearId)).toEqual(['wear-1', 'wear-1']);
    expect(screen.queryByText("Couldn't connect. Check your internet and try again.")).toBeNull();
  });

  test("a lost wear for one outfit keeps its id after trying another one", async () => {
    mockedFetch.mockReturnValue(ok(list()));
    mockedLogWear
      .mockResolvedValueOnce({ ok: false, error: 'network' })
      .mockResolvedValueOnce({ ok: false, error: 'network' })
      .mockResolvedValueOnce({ ok: true });
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
    await screen.findByText("Couldn't connect. Check your internet and try again.");
    await fireEvent.press(screen.getByRole('button', { name: 'Another' }));
    await fireEvent.press(screen.getByRole('button', { name: "I'll wear it" }));
    await screen.findByText("Couldn't connect. Check your internet and try again.");
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

    await fireEvent.press(await screen.findByRole('button', { name: 'Add your city for the weather' }));
    expect(mockedPush).toHaveBeenCalledWith('/city');
  });

  test('a city that gave no weather says so, and tapping it opens the city modal', async () => {
    mockedFetch.mockReturnValue(ok(list(undefined, null)));
    mockedGetProfile.mockResolvedValue({ city_name: 'Atlantis' } as Profile);
    await render(<TodayScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Weather unavailable for Atlantis' }));
    expect(mockedPush).toHaveBeenCalledWith('/city');
    expect(screen.queryByText('Add your city for the weather')).toBeNull();
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

  test('over quota shows the quota message without a retry', async () => {
    mockedFetch.mockResolvedValue({ ok: false, error: 'over_quota' });
    await render(<TodayScreen />);

    expect(await screen.findByText("You've used today's outfit suggestions. Try again tomorrow.")).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
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
