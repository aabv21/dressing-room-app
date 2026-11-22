// "Pack for a trip": the city (typed or dictated), the start day, the length and an occasion, then
// each day's outfit and the packing list with its check-offs, and Save. Rendered directly with the
// function call and the saved-trips repository mocked.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import TripScreen from '../app/trip';
import type { Garment } from '../closet/garmentRepository';
import { kvKeys, kvRemove } from '../lib/kv';
import { hear } from '../test/dictation';
import { garment } from '../test/garmentFixture';
import { deleteSavedTrip, listSavedTrips, saveTrip, type SavedTrip } from '../trips/savedTrips';
import { planTripRequest, type TripResponse } from '../trips/tripClient';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, useIsFocused: () => true }));
const mockLocales = { tags: ['en-US'] };
jest.mock('expo-localization', () => ({
  getLocales: () => mockLocales.tags.map((languageTag) => ({ languageTag, languageCode: languageTag.slice(0, 2) })),
}));
jest.mock('../lib/supabase', () => ({ supabase: {} }));
jest.mock('../lib/localDate', () => ({ localDate: () => '2026-11-21' }));
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));
jest.mock('../trips/tripClient', () => ({ ...jest.requireActual<object>('../trips/tripClient'), planTripRequest: jest.fn() }));
jest.mock('../trips/savedTrips', () => ({ listSavedTrips: jest.fn(), saveTrip: jest.fn(), deleteSavedTrip: jest.fn() }));

const TEE = '00000000-0000-4000-8000-000000000001';
const SHIRT = '00000000-0000-4000-8000-000000000002';
const JEANS = '00000000-0000-4000-8000-000000000003';
const SNEAKERS = '00000000-0000-4000-8000-000000000004';

const mockCloset: { garments: Garment[] } = { garments: [] };
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({ garments: mockCloset.garments, thumbUrls: new Map<string, string>(), status: 'ready' }),
}));

const CLOSET: Garment[] = [
  garment({ id: TEE, category: 't_shirt', colors: ['white'] }),
  garment({ id: SHIRT, category: 'shirt', colors: ['gray'] }),
  garment({ id: JEANS, category: 'jeans', colors: ['blue'] }),
  garment({ id: SNEAKERS, category: 'sneakers', colors: ['white'] }),
];

const PLAN: TripResponse = {
  kind: 'ok',
  city: 'Lisbon',
  days: [
    { date: '2026-12-01', weather: { tempC: 18, condition: 'clear', band: 'cool', rain: false }, garmentIds: [TEE, JEANS, SNEAKERS] },
    { date: '2026-12-02', weather: null, garmentIds: [SHIRT, JEANS, SNEAKERS] },
  ],
  packing: [
    { slot: 'top', items: [{ garmentId: TEE, days: 1 }, { garmentId: SHIRT, days: 1 }] },
    { slot: 'bottom', items: [{ garmentId: JEANS, days: 2 }] },
    { slot: 'shoes', items: [{ garmentId: SNEAKERS, days: 2 }] },
  ],
};

const mockedPlan = jest.mocked(planTripRequest);
const mockedList = jest.mocked(listSavedTrips);
const mockedSave = jest.mocked(saveTrip);
const mockedDelete = jest.mocked(deleteSavedTrip);

beforeEach(() => {
  for (const key of kvKeys()) kvRemove(key);
  mockLocales.tags = ['en-US'];
  mockCloset.garments = CLOSET;
  mockedPlan.mockReset().mockResolvedValue({ ok: true, result: PLAN });
  mockedList.mockReset().mockResolvedValue([]);
  mockedSave.mockReset();
  mockedDelete.mockReset();
});

async function planLisbon(): Promise<void> {
  await fireEvent.changeText(screen.getByTestId('trip-city'), 'Lisbon');
  await fireEvent.press(screen.getByRole('radio', { name: 'Tue, Dec 1' }));
  await fireEvent.press(screen.getByRole('radio', { name: '2 days' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Plan my packing' }));
}

test('sends the city, the dates, the occasion, the language and the local day', async () => {
  await render(<TripScreen />);
  expect(screen.getByRole('header', { name: 'Pack for a trip' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Plan my packing' })).toBeDisabled();

  await fireEvent.press(screen.getByRole('radio', { name: 'Going out' }));
  await planLisbon();

  expect(mockedPlan).toHaveBeenCalledWith({
    city: 'Lisbon',
    start: '2026-12-01',
    end: '2026-12-02',
    occasion: 'going_out',
    language: 'en',
    date: '2026-11-21',
  });
});

test('shows each day with its forecast (or none) and outfit, and the packing list by slot', async () => {
  await render(<TripScreen />);
  await planLisbon();

  const first = await screen.findByTestId('trip-day-2026-12-01');
  expect(within(first).getByText(/18 °C, sunny/)).toBeOnTheScreen();
  expect(within(first).getByText('T-shirt · White')).toBeOnTheScreen();
  expect(within(screen.getByTestId('trip-day-2026-12-02')).getByText('Forecast unavailable')).toBeOnTheScreen();

  const list = screen.getByTestId('trip-packing');
  expect(within(list).getByText('Tops · 2')).toBeOnTheScreen();
  expect(within(list).getByRole('checkbox', { name: 'Jeans · Blue, worn 2 days' })).not.toBeChecked();
});

test('a check-off is kept for the trip, also after leaving and planning it again', async () => {
  const view = await render(<TripScreen />);
  await planLisbon();
  await fireEvent.press(await screen.findByRole('checkbox', { name: 'Jeans · Blue, worn 2 days' }));
  expect(screen.getByRole('checkbox', { name: 'Jeans · Blue, worn 2 days' })).toBeChecked();
  await view.unmount();

  await render(<TripScreen />);
  await planLisbon();
  expect(await screen.findByRole('checkbox', { name: 'Jeans · Blue, worn 2 days' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'T-shirt · White, worn 1 day' })).not.toBeChecked();
});

test('Save keeps the trip with its snapshot; nothing is saved without the tap', async () => {
  const saved: SavedTrip = { id: 't-1', city: 'Lisbon', start: '2026-12-01', end: '2026-12-02', occasion: null, result: PLAN };
  mockedSave.mockResolvedValue({ ok: true, trip: saved });
  await render(<TripScreen />);
  await planLisbon();
  await screen.findByTestId('trip-packing');
  expect(mockedSave).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'Save trip' }));

  expect(mockedSave).toHaveBeenCalledWith({ city: 'Lisbon', start: '2026-12-01', end: '2026-12-02', occasion: null, result: PLAN });
  expect(await screen.findByRole('button', { name: 'Saved ✓' })).toBeDisabled();
});

test('a saved trip opens its snapshot without a call, and can be deleted', async () => {
  mockedList.mockResolvedValue([{ id: 't-1', city: 'Lisbon', start: '2026-12-01', end: '2026-12-02', occasion: null, result: PLAN }]);
  mockedDelete.mockResolvedValue({ ok: true });
  await render(<TripScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Open Lisbon, Tue, Dec 1 to Wed, Dec 2' }));
  expect(await screen.findByTestId('trip-packing')).toBeOnTheScreen();
  expect(mockedPlan).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'New trip' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Delete Lisbon, Tue, Dec 1 to Wed, Dec 2' }));
  expect(mockedDelete).toHaveBeenCalledWith('t-1');
  expect(screen.queryByRole('button', { name: /^Open Lisbon/ })).toBeNull();
});

test('the dictation mic fills the city', async () => {
  await render(<TripScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Dictate the city' }));
  await act(() => {
    hear('Cartagena');
  });

  expect(await screen.findByDisplayValue('Cartagena')).toBeOnTheScreen();
});

test.each([
  ['not_found', "Couldn't find that city. Check the spelling and try again."],
  ['over_quota', "You've planned 5 trips today. Try again tomorrow."],
  ['network', "Couldn't plan the trip. Check your internet and try again."],
] as const)('%s says why', async (error, message) => {
  mockedPlan.mockResolvedValue({ ok: false, error });
  await render(<TripScreen />);
  await planLisbon();
  expect(await screen.findByText(message)).toBeOnTheScreen();
});

test('a closet missing a slot says what to add', async () => {
  mockedPlan.mockResolvedValue({ ok: true, result: { kind: 'too_small', missing: ['shoes'] } });
  await render(<TripScreen />);
  await planLisbon();
  expect(await screen.findByText('Add shoes to your closet to plan a trip.')).toBeOnTheScreen();
});

test('in Spanish', async () => {
  mockLocales.tags = ['es-CO'];
  await render(<TripScreen />);
  expect(screen.getByRole('header', { name: 'Armar la maleta' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Planear la maleta' })).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: '3 días' })).toBeOnTheScreen();
});
