// The Plan screen: a 14-day strip, the chosen day's plan, and an outfit from Saved, Today's
// suggestions or Build, planned for that day. Rendered directly with the repositories mocked.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import PlanScreen from '../app/plan';
import type { Garment } from '../closet/garmentRepository';
import { kvKeys, kvRemove, kvSet } from '../lib/kv';
import { listSavedOutfits, type SavedOutfit } from '../outfits/savedOutfits';
import { storeLucky } from '../outfits/storedLucky';
import { listPlans, planOutfit, removePlan, type PlannedOutfit } from '../planner/plannedOutfits';
import { plansKey, readStoredPlans } from '../planner/planCache';
import { garment } from '../test/garmentFixture';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), setParams: jest.fn() },
  useIsFocused: jest.fn(() => true),
  useLocalSearchParams: jest.fn(() => ({})),
}));
const mockLocales = { tags: ['en-US'] };
jest.mock('expo-localization', () => ({
  getLocales: () => mockLocales.tags.map((languageTag) => ({ languageTag, languageCode: languageTag.slice(0, 2) })),
}));
jest.mock('../lib/localDate', () => ({ localDate: () => '2026-11-21' }));
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));
jest.mock('../outfits/savedOutfits', () => ({ listSavedOutfits: jest.fn(), deleteSavedOutfit: jest.fn() }));
jest.mock('../planner/plannedOutfits', () => ({ listPlans: jest.fn(), planOutfit: jest.fn(), removePlan: jest.fn() }));

const BLOUSE = '00000000-0000-4000-8000-000000000001';
const JEANS = '00000000-0000-4000-8000-000000000002';
const SNEAKERS = '00000000-0000-4000-8000-000000000003';
const SKIRT = '00000000-0000-4000-8000-000000000004';

const mockCloset: { garments: Garment[] } = { garments: [] };
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockCloset.garments,
    thumbUrls: new Map<string, string>(),
    status: 'ready',
    refresh: () => Promise.resolve(),
    replaceLocal: () => undefined,
    removeLocal: () => undefined,
  }),
}));

const done = { extraction_status: 'done', reviewed_at: '2026-09-01T12:00:00.000Z' } as const;
const CLOSET: Garment[] = [
  garment({ ...done, id: BLOUSE, category: 'blouse', colors: ['white'] }),
  garment({ ...done, id: JEANS, category: 'jeans', colors: ['blue'] }),
  garment({ ...done, id: SNEAKERS, category: 'sneakers', colors: ['white'] }),
  garment({ ...done, id: SKIRT, category: 'skirt', colors: ['camel'] }),
];

const SAVED: SavedOutfit = { id: 'o-1', savedAt: '2026-11-20T15:00:00Z', score: 82, garmentIds: [BLOUSE, JEANS, SNEAKERS] };
const MONDAY_PLAN: PlannedOutfit = { id: 'p-1', day: '2026-11-23', garmentIds: [BLOUSE, SKIRT, SNEAKERS], occasion: null };

const mockedParams = jest.mocked(useLocalSearchParams);
const mockedList = jest.mocked(listPlans);
const mockedPlan = jest.mocked(planOutfit);
const mockedRemove = jest.mocked(removePlan);
const mockedSaved = jest.mocked(listSavedOutfits);

beforeEach(() => {
  for (const key of kvKeys()) kvRemove(key);
  mockLocales.tags = ['en-US'];
  mockCloset.garments = CLOSET;
  mockedParams.mockReturnValue({});
  mockedList.mockReset().mockResolvedValue([]);
  mockedPlan.mockReset();
  mockedRemove.mockReset();
  mockedSaved.mockReset().mockResolvedValue([SAVED]);
  jest.mocked(router.push).mockClear();
  jest.mocked(router.navigate).mockClear();
  jest.mocked(router.setParams).mockClear();
});

const day = (name: string | RegExp) => screen.getByRole('radio', { name });

test('shows the 14 days from today, today chosen, with planned days marked', async () => {
  mockedList.mockResolvedValue([MONDAY_PLAN]);
  await render(<PlanScreen />);

  expect(screen.getByRole('header', { name: 'Plan ahead' })).toBeOnTheScreen();
  expect(await screen.findByRole('radio', { name: 'Mon, Nov 23, planned' })).toBeOnTheScreen();
  expect(within(screen.getByTestId('plan-days')).getAllByRole('radio')).toHaveLength(14);
  expect(day('Sat, Nov 21')).toBeSelected();
  expect(day('Fri, Dec 4')).toBeOnTheScreen();
  expect(mockedList).toHaveBeenCalledWith('2026-11-21', '2026-12-04');
  expect(screen.getByText('Nothing planned for Sat, Nov 21.')).toBeOnTheScreen();
});

test('a Saved outfit planned for the chosen day is stored and shown as that day’s plan', async () => {
  mockedPlan.mockResolvedValue({ ok: true, plan: { id: 'p-9', day: '2026-11-24', garmentIds: SAVED.garmentIds, occasion: null } });
  await render(<PlanScreen />);

  await fireEvent.press(day('Tue, Nov 24'));
  await fireEvent.press(await screen.findByRole('button', { name: /^Use this outfit/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Plan for Tue, Nov 24' }));

  expect(mockedPlan).toHaveBeenCalledWith({ day: '2026-11-24', garmentIds: [BLOUSE, JEANS, SNEAKERS], occasion: null });
  const card = await screen.findByTestId('day-plan');
  expect(within(card).getByText('Planned for Tue, Nov 24')).toBeOnTheScreen();
  expect(readStoredPlans('user-1').map((plan) => plan.day)).toEqual(['2026-11-24']);
  expect(day('Tue, Nov 24, planned')).toBeSelected();
});

test('one of Today’s suggestions can be planned', async () => {
  storeLucky('user-1', '2026-11-21', null, {
    kind: 'ok',
    weather: null,
    outfits: [{ garmentIds: [BLOUSE, SKIRT, SNEAKERS], score: 77, freshThisWeek: true }],
  });
  mockedPlan.mockResolvedValue({ ok: true, plan: { id: 'p-9', day: '2026-11-21', garmentIds: [BLOUSE, SKIRT, SNEAKERS], occasion: null } });
  await render(<PlanScreen />);

  await fireEvent.press(screen.getByRole('radio', { name: 'Suggestions' }));
  await fireEvent.press(screen.getByRole('button', { name: /^Use this outfit/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Plan for Sat, Nov 21' }));

  expect(mockedPlan).toHaveBeenCalledWith({ day: '2026-11-21', garmentIds: [BLOUSE, SKIRT, SNEAKERS], occasion: null });
});

test('with no suggestions stored it points to Today', async () => {
  await render(<PlanScreen />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Suggestions' }));
  expect(screen.getByText('Open Today to get suggestions, then come back.')).toBeOnTheScreen();
});

test('"Build one" opens Build to plan for the chosen day', async () => {
  await render(<PlanScreen />);

  await fireEvent.press(day('Wed, Nov 25'));
  await fireEvent.press(screen.getByRole('button', { name: 'Build one' }));

  expect(router.navigate).toHaveBeenCalledWith({ pathname: '/build', params: { planFor: '2026-11-25' } });
});

test('an outfit sent back from Build is chosen for its day, ready to plan', async () => {
  mockedParams.mockReturnValue({ day: '2026-11-25', ids: [BLOUSE, JEANS, SNEAKERS].join(',') });
  mockedPlan.mockResolvedValue({ ok: true, plan: { id: 'p-9', day: '2026-11-25', garmentIds: [BLOUSE, JEANS, SNEAKERS], occasion: null } });
  await render(<PlanScreen />);

  expect(day('Wed, Nov 25')).toBeSelected();
  expect(screen.getByTestId('pending-outfit')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Plan for Wed, Nov 25' }));
  expect(mockedPlan).toHaveBeenCalledWith({ day: '2026-11-25', garmentIds: [BLOUSE, JEANS, SNEAKERS], occasion: null });
});

test('a day outside the window or unknown ids from a link are ignored', async () => {
  mockedParams.mockReturnValue({ day: '2026-12-25', ids: 'not-a-garment,also-not' });
  await render(<PlanScreen />);

  expect(day('Sat, Nov 21')).toBeSelected();
  expect(screen.queryByTestId('pending-outfit')).toBeNull();
});

test('Remove deletes the day’s plan', async () => {
  kvSet(plansKey('user-1'), JSON.stringify([MONDAY_PLAN]));
  mockedList.mockReturnValue(new Promise<never>(() => undefined));
  mockedRemove.mockResolvedValue({ ok: true });
  await render(<PlanScreen />);

  await fireEvent.press(day('Mon, Nov 23, planned'));
  await fireEvent.press(within(screen.getByTestId('day-plan')).getByRole('button', { name: 'Remove plan' }));

  expect(mockedRemove).toHaveBeenCalledWith('p-1');
  expect(await screen.findByText('Nothing planned for Mon, Nov 23.')).toBeOnTheScreen();
});

test('a failed save says why and plans nothing', async () => {
  mockedPlan.mockResolvedValue({ ok: false, error: 'network' });
  await render(<PlanScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: /^Use this outfit/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Plan for Sat, Nov 21' }));

  expect(await screen.findByText("Couldn't save the plan. Check your internet and try again.")).toBeOnTheScreen();
  expect(readStoredPlans('user-1')).toEqual([]);
});

test('in Spanish', async () => {
  mockLocales.tags = ['es-CO'];
  await render(<PlanScreen />);

  expect(screen.getByRole('header', { name: 'Planear' })).toBeOnTheScreen();
  expect(day('sáb, 21 nov')).toBeSelected();
  expect(screen.getByText('Sin plan para sáb, 21 nov.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Armar uno' })).toBeOnTheScreen();
});
