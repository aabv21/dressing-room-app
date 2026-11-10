// "I'll wear it" across screens: Today and the rating share one worn-today record, so an outfit
// logged on either shows "Logged ✓" on both, also after a restart. Today and the rating screen are
// rendered together the way the stack keeps Today mounted under /rate.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';

import TodayScreen from '../app/(tabs)/index';
import RateScreen from '../app/rate';
import type { Garment } from '../closet/garmentRepository';
import { kvRemove } from '../lib/kv';
import { fetchLuckyList, rateOutfit } from '../outfits/aiClient';
import { logWear } from '../outfits/outfitRepository';
import type { LuckyOutfit, RatingResult } from '../outfits/types';
import { isWornToday, markWornToday, unmarkWornToday } from '../outfits/wornToday';
import { getProfile, type Profile } from '../profile/profileRepository';
import { garment } from '../test/garmentFixture';

const TOP = '00000000-0000-4000-8000-000000000001';
const JEANS = '00000000-0000-4000-8000-000000000002';
const SNEAKERS = '00000000-0000-4000-8000-000000000003';
const SKIRT = '00000000-0000-4000-8000-000000000004';

const mockParams: { ids?: string } = {};
const mockFocus = { focused: true };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useIsFocused: () => mockFocus.focused,
  useLocalSearchParams: () => mockParams,
}));

const mockAuth = { userId: 'user-1' };
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

const mockGarments: Garment[] = [];
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockGarments,
    thumbUrls: new Map<string, string>(),
    status: 'ready',
    refresh: () => Promise.resolve(),
    replaceLocal: jest.fn(),
    removeLocal: jest.fn(),
  }),
}));

jest.mock('../outfits/aiClient', () => ({
  fetchLuckyList: jest.fn(),
  rateOutfit: jest.fn(),
  localDate: () => '2026-11-08',
}));

jest.mock('../outfits/outfitRepository', () => ({ logWear: jest.fn(), saveOutfit: jest.fn() }));

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

jest.mock('../profile/profileRepository', () => ({ getProfile: jest.fn() }));

const FIRST: LuckyOutfit = { garmentIds: [SNEAKERS, JEANS, TOP], score: 88, freshThisWeek: false };
const SECOND: LuckyOutfit = { garmentIds: [TOP, SKIRT, SNEAKERS], score: 80, freshThisWeek: false };

const RATING: RatingResult = {
  score: 78,
  label: 'good',
  confidence: 85,
  estimated: false,
  reasons: [],
  weakestSlot: null,
  swap: null,
  noBetterSwap: false,
};

beforeEach(() => {
  mockAuth.userId = 'user-1';
  mockFocus.focused = true;
  mockGarments.splice(
    0,
    mockGarments.length,
    garment({ id: TOP, category: 'blouse', colors: ['white'], extraction_status: 'done' }),
    garment({ id: JEANS, category: 'jeans', colors: ['blue'], extraction_status: 'done' }),
    garment({ id: SNEAKERS, category: 'sneakers', colors: ['white'], extraction_status: 'done' }),
    garment({ id: SKIRT, category: 'skirt', colors: ['camel'], extraction_status: 'done' }),
  );
  for (const user of ['user-1', 'user-2']) {
    kvRemove(`outfit.worn.${user}`);
    kvRemove(`today.lucky.${user}`);
  }
  jest.mocked(fetchLuckyList).mockResolvedValue({ ok: true, result: { kind: 'ok', weather: null, outfits: [FIRST, SECOND] } });
  jest.mocked(rateOutfit).mockResolvedValue({ ok: true, result: RATING });
  jest.mocked(logWear).mockReset();
  jest.mocked(logWear).mockResolvedValue({ ok: true });
  jest.mocked(randomUUID).mockReturnValue('wear-1');
  jest.mocked(getProfile).mockResolvedValue({ city_name: null } as Profile);
});

/** Today with the rating screen pushed over it (Today stays mounted and loses focus). */
function stack(rating: boolean): React.JSX.Element {
  return (
    <>
      <TodayScreen />
      {rating ? <RateScreen /> : null}
    </>
  );
}

test("an outfit worn from the rating shows Logged ✓ back on Today, and still after a restart", async () => {
  const view = await render(stack(false));
  expect(await screen.findByRole('button', { name: "I'll wear it" })).toBeEnabled();

  // "How does it look?" → the rating, with the ids in another order than Today's.
  mockFocus.focused = false;
  mockParams.ids = [TOP, JEANS, SNEAKERS].join(',');
  await view.rerender(stack(true));
  await screen.findByText('78%');
  // Today's button comes first; the rating's is the last one.
  const rateWear = screen.getAllByRole('button', { name: "I'll wear it" }).at(-1);
  if (rateWear === undefined) throw new Error("the rating's I'll wear it is missing");
  await fireEvent.press(rateWear);
  expect(await screen.findAllByRole('button', { name: 'Logged ✓' })).toHaveLength(2);
  expect(logWear).toHaveBeenCalledTimes(1);

  // Back to Today.
  mockFocus.focused = true;
  await view.rerender(stack(false));
  expect(screen.getByRole('button', { name: 'Logged ✓' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Logged ✓' }));
  expect(logWear).toHaveBeenCalledTimes(1);

  // A different outfit isn't affected.
  await fireEvent.press(screen.getByRole('button', { name: 'Another' }));
  expect(screen.getByRole('button', { name: "I'll wear it" })).toBeEnabled();

  // A restart: a fresh mount reads the record.
  await view.unmount();
  await render(stack(false));
  expect(await screen.findByRole('button', { name: 'Logged ✓' })).toBeDisabled();
});

test('an outfit worn on Today opens as Logged ✓ on the rating', async () => {
  const view = await render(stack(false));
  await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
  await screen.findByRole('button', { name: 'Logged ✓' });

  mockFocus.focused = false;
  mockParams.ids = [JEANS, SNEAKERS, TOP].join(',');
  await view.rerender(stack(true));
  await screen.findByText('78%');

  expect(screen.queryByRole('button', { name: "I'll wear it" })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Logged ✓' })).toHaveLength(2);
  expect(logWear).toHaveBeenCalledTimes(1);
});

test("another user's record isn't read", async () => {
  mockAuth.userId = 'user-2';
  const first = await render(stack(false));
  await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
  await screen.findByRole('button', { name: 'Logged ✓' });
  await first.unmount();

  mockAuth.userId = 'user-1';
  await render(stack(false));
  expect(await screen.findByRole('button', { name: "I'll wear it" })).toBeEnabled();
});

test("a deleted wear (the diary's Delete) clears Logged ✓ on Today and the rating, so it can be logged again", async () => {
  const view = await render(stack(false));
  await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
  await screen.findByRole('button', { name: 'Logged ✓' });

  mockFocus.focused = false;
  mockParams.ids = [JEANS, TOP, SNEAKERS].join(',');
  await view.rerender(stack(true));
  await screen.findByText('78%');
  expect(screen.getAllByRole('button', { name: 'Logged ✓' })).toHaveLength(2);

  // The diary hands the wear's garment ids in yet another order.
  await act(() => {
    unmarkWornToday('user-1', [TOP, SNEAKERS, JEANS]);
  });
  expect(screen.queryByRole('button', { name: 'Logged ✓' })).toBeNull();
  expect(screen.getAllByRole('button', { name: "I'll wear it" })).toHaveLength(2);
});

describe('unmarkWornToday', () => {
  test("removes only that outfit and keeps the record's day", () => {
    markWornToday('user-1', '2026-11-08', [TOP, JEANS, SNEAKERS]);
    markWornToday('user-1', '2026-11-08', [TOP, SKIRT, SNEAKERS]);

    unmarkWornToday('user-1', [SNEAKERS, JEANS, TOP]);

    expect(isWornToday('user-1', '2026-11-08', [TOP, JEANS, SNEAKERS])).toBe(false);
    expect(isWornToday('user-1', '2026-11-08', [TOP, SKIRT, SNEAKERS])).toBe(true);
  });

  test("leaves another user's record alone and is a no-op without a record", () => {
    markWornToday('user-2', '2026-11-08', [TOP, JEANS, SNEAKERS]);

    unmarkWornToday('user-1', [TOP, JEANS, SNEAKERS]);

    expect(isWornToday('user-2', '2026-11-08', [TOP, JEANS, SNEAKERS])).toBe(true);
    expect(isWornToday('user-1', '2026-11-08', [TOP, JEANS, SNEAKERS])).toBe(false);
  });
});
