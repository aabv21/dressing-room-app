// The Closet tab's Saved segment: the saved outfits newest first, each with its pieces, saved date
// and score, and Rate, "I'll wear it" (with Undo) and Delete; offline, the stored list.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { Alert, type AlertButton } from 'react-native';

import ClosetScreen from '../app/(tabs)/closet';
import type { Garment } from '../closet/garmentRepository';
import { kvRemove } from '../lib/kv';
import { logWear } from '../outfits/outfitRepository';
import { deleteSavedOutfit, listSavedOutfits, type SavedOutfit } from '../outfits/savedOutfits';
import { readStoredSaved, storedSavedKey, storeSaved } from '../outfits/storedSaved';
import { wearQueueKey } from '../outfits/wearQueue';
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
  router: { push: jest.fn(), setParams: jest.fn() },
  useIsFocused: jest.fn(() => true),
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../lib/localDate', () => ({ localDate: () => '2026-11-21' }));
jest.mock('../stats/wearsRepository', () => ({ listWears: jest.fn(() => new Promise(() => undefined)), deleteWear: jest.fn() }));
jest.mock('../outfits/savedOutfits', () => ({ listSavedOutfits: jest.fn(), deleteSavedOutfit: jest.fn() }));
jest.mock('../outfits/outfitRepository', () => ({ logWear: jest.fn() }));
jest.mock('../closet/garmentRepository', () => ({ updateGarment: jest.fn() }));
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));

const mockRefresh = jest.fn(() => Promise.resolve());
const mockCloset: { garments: Garment[] } = { garments: [] };
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockCloset.garments,
    thumbUrls: new Map<string, string>(),
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

const done = { extraction_status: 'done', reviewed_at: '2026-09-01T12:00:00.000Z' } as const;
const CLOSET: Garment[] = [
  garment({ ...done, id: BLOUSE, category: 'blouse', colors: ['white'] }),
  garment({ ...done, id: JEANS, category: 'jeans', colors: ['blue'] }),
  garment({ ...done, id: SNEAKERS, category: 'sneakers', colors: ['white'] }),
  garment({ ...done, id: DRESS, category: 'dress', colors: ['black'] }),
];

const NEWEST: SavedOutfit = { id: 'o-2', savedAt: '2026-11-20T15:00:00Z', score: 82, garmentIds: [JEANS, BLOUSE, SNEAKERS] };
const OLDER: SavedOutfit = { id: 'o-1', savedAt: '2026-10-03T15:00:00Z', score: null, garmentIds: [DRESS, SNEAKERS] };

const mockedList = jest.mocked(listSavedOutfits);
const mockedDelete = jest.mocked(deleteSavedOutfit);
const mockedLogWear = jest.mocked(logWear);

beforeEach(() => {
  jest.clearAllMocks();
  mockCloset.garments = CLOSET;
  mockedList.mockResolvedValue([NEWEST, OLDER]);
  mockedDelete.mockResolvedValue({ ok: true });
  mockedLogWear.mockResolvedValue({ ok: true });
  jest.mocked(randomUUID).mockReturnValue('wear-1');
  kvRemove(storedSavedKey('user-1'));
  kvRemove('outfit.worn.user-1');
  kvRemove(wearQueueKey('user-1'));
});

function lastAlertButtons(spy: jest.SpyInstance): AlertButton[] {
  const call = spy.mock.calls.at(-1) as [string, string, AlertButton[]] | undefined;
  if (call === undefined) throw new Error('no alert was shown');
  return call[2];
}

async function openSaved(): Promise<void> {
  await render(<ClosetScreen />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Saved' }));
  await screen.findByTestId('saved-outfit-o-2');
}

const card = (id: string) => screen.getByTestId(`saved-outfit-${id}`);

test('lists the saved outfits newest first, with the saved date, the score when known and the pieces', async () => {
  await openSaved();

  const cards = screen.getAllByTestId(/^saved-outfit-/);
  expect(cards.map((c) => c.props.testID as string)).toEqual(['saved-outfit-o-2', 'saved-outfit-o-1']);
  expect(within(card('o-2')).getByText('Saved November 20')).toBeOnTheScreen();
  expect(within(card('o-2')).getByText('82%')).toBeOnTheScreen();
  expect(within(card('o-1')).getByText('Saved October 3')).toBeOnTheScreen();
  expect(within(card('o-1')).queryByText(/%$/)).toBeNull();
  expect(within(card('o-2')).getByText('Blouse · White')).toBeOnTheScreen();
  expect(screen.getByText('2 saved outfits')).toBeOnTheScreen();
  // Stored for offline use.
  expect(readStoredSaved('user-1')).toEqual([NEWEST, OLDER]);
});

test('Rate opens the rating for that outfit', async () => {
  await openSaved();

  await fireEvent.press(within(card('o-2')).getByRole('button', { name: 'Rate' }));

  expect(router.push).toHaveBeenCalledWith({ pathname: '/rate', params: { ids: NEWEST.garmentIds.join(',') } });
});

test("I'll wear it logs the outfit with its score, then offers Undo", async () => {
  await openSaved();

  await fireEvent.press(within(card('o-2')).getByRole('button', { name: "I'll wear it" }));

  expect(mockedLogWear).toHaveBeenCalledWith(
    expect.objectContaining({ wearId: 'wear-1', garmentIds: NEWEST.garmentIds, wornOn: '2026-11-21', occasion: null, score: 82 }),
  );
  expect(await within(card('o-2')).findByRole('button', { name: 'Logged ✓' })).toBeDisabled();
  expect(within(card('o-2')).getByRole('button', { name: 'Undo' })).toBeOnTheScreen();
  // The other outfit is untouched.
  expect(within(card('o-1')).getByRole('button', { name: "I'll wear it" })).toBeEnabled();
});

test('Delete asks first; Cancel keeps it, Delete removes it', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await openSaved();

  await fireEvent.press(within(card('o-1')).getByRole('button', { name: 'Delete' }));
  expect(alert).toHaveBeenCalledWith('Delete this saved outfit?', expect.any(String), expect.any(Array));
  expect(mockedDelete).not.toHaveBeenCalled();

  const confirm = lastAlertButtons(alert).find((button) => button.text === 'Delete');
  await act(async () => {
    confirm?.onPress?.();
    await Promise.resolve();
  });

  expect(mockedDelete).toHaveBeenCalledWith('o-1');
  expect(screen.queryByTestId('saved-outfit-o-1')).toBeNull();
  expect(screen.getByTestId('saved-outfit-o-2')).toBeOnTheScreen();
  alert.mockRestore();
});

test('a failed delete keeps the outfit and says why', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  mockedDelete.mockResolvedValue({ ok: false, error: 'network' });
  await openSaved();

  await fireEvent.press(within(card('o-1')).getByRole('button', { name: 'Delete' }));
  await act(async () => {
    lastAlertButtons(alert)
      .find((button) => button.text === 'Delete')
      ?.onPress?.();
    await Promise.resolve();
  });

  expect(card('o-1')).toBeOnTheScreen();
  expect(within(card('o-1')).getByRole('alert')).toHaveTextContent("Couldn't delete this outfit. Check your internet and try again.");
  alert.mockRestore();
});

test('offline, the stored list shows with a note', async () => {
  storeSaved('user-1', [OLDER]);
  mockedList.mockRejectedValue(new Error('offline'));

  await render(<ClosetScreen />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Saved' }));

  expect(await screen.findByTestId('saved-outfit-o-1')).toBeOnTheScreen();
  expect(screen.getByText('Offline: your saved outfits from your last visit.')).toBeOnTheScreen();
});

test('no saved outfits yet says how to save one', async () => {
  mockedList.mockResolvedValue([]);

  await render(<ClosetScreen />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Saved' }));

  expect(await screen.findByText('No saved outfits yet. Save one from its rating.')).toBeOnTheScreen();
});

test('opening the Closet with segment=saved shows the Saved segment', async () => {
  const { useLocalSearchParams } = jest.requireMock<{ useLocalSearchParams: jest.Mock }>('expo-router');
  useLocalSearchParams.mockReturnValue({ segment: 'saved' });

  await render(<ClosetScreen />);

  expect(await screen.findByTestId('saved-outfit-o-2')).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: 'Saved' })).toBeSelected();
  expect(router.setParams).toHaveBeenCalledWith({ segment: undefined });
  useLocalSearchParams.mockReturnValue({});
});
