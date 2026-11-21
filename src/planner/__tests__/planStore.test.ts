import { act, renderHook } from '@testing-library/react-native';

import { forgetAccountOnDevice, forgetDisplayCaches } from '../../account/forgetAccount';
import { allowUserKeys, kvGet, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import { listPlans, planOutfit, removePlan, type PlannedOutfit } from '../plannedOutfits';
import { planDays, planFor, plansKey, readStoredPlans, usePlans } from '../planCache';
import { deletePlan, refreshPlans, savePlan } from '../planStore';

jest.mock('../plannedOutfits', () => ({ listPlans: jest.fn(), planOutfit: jest.fn(), removePlan: jest.fn() }));

const USER = 'user-1';
const mockedList = jest.mocked(listPlans);
const mockedPlan = jest.mocked(planOutfit);
const mockedRemove = jest.mocked(removePlan);

const MONDAY: PlannedOutfit = { id: 'p-1', day: '2026-11-23', garmentIds: ['g-1', 'g-2', 'g-3'], occasion: null };
const TUESDAY: PlannedOutfit = { id: 'p-2', day: '2026-11-24', garmentIds: ['g-4', 'g-5'], occasion: 'office' };

beforeEach(() => {
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(USER);
  mockedList.mockReset();
  mockedPlan.mockReset();
  mockedRemove.mockReset();
});

test('planDays: today and the 13 days after it, across a month end', () => {
  const days = planDays('2026-11-25');
  expect(days).toHaveLength(14);
  expect(days[0]).toBe('2026-11-25');
  expect(days[6]).toBe('2026-12-01');
  expect(days.at(-1)).toBe('2026-12-08');
});

test('refreshPlans reads the window and stores it under plans.v1.<userId>', async () => {
  mockedList.mockResolvedValueOnce([MONDAY, TUESDAY]);

  await expect(refreshPlans(USER, '2026-11-21')).resolves.toBe(true);

  expect(mockedList).toHaveBeenCalledWith('2026-11-21', '2026-12-04');
  expect(plansKey(USER)).toBe('plans.v1.user-1');
  expect(readStoredPlans(USER)).toEqual([MONDAY, TUESDAY]);
});

test('a failed refresh keeps the stored plans', async () => {
  kvSet(plansKey(USER), JSON.stringify([MONDAY]));
  mockedList.mockRejectedValueOnce(new Error('offline'));

  await expect(refreshPlans(USER, '2026-11-21')).resolves.toBe(false);
  expect(readStoredPlans(USER)).toEqual([MONDAY]);
});

test('a stored value of another shape reads as no plans', () => {
  kvSet(plansKey(USER), JSON.stringify([{ id: 1 }]));
  expect(readStoredPlans(USER)).toEqual([]);
});

test('savePlan replaces that day’s plan in the store once the server has it', async () => {
  kvSet(plansKey(USER), JSON.stringify([MONDAY, TUESDAY]));
  const replacement: PlannedOutfit = { ...MONDAY, garmentIds: ['g-7', 'g-8'] };
  mockedPlan.mockResolvedValueOnce({ ok: true, plan: replacement });

  await expect(savePlan(USER, { day: MONDAY.day, garmentIds: ['g-7', 'g-8'], occasion: null })).resolves.toEqual({ ok: true });

  expect(readStoredPlans(USER)).toEqual([replacement, TUESDAY]);
});

test('a failed save leaves the store as it was', async () => {
  kvSet(plansKey(USER), JSON.stringify([MONDAY]));
  mockedPlan.mockResolvedValueOnce({ ok: false, error: 'network' });

  await expect(savePlan(USER, { day: TUESDAY.day, garmentIds: TUESDAY.garmentIds, occasion: null })).resolves.toEqual({
    ok: false,
    error: 'network',
  });
  expect(readStoredPlans(USER)).toEqual([MONDAY]);
});

test('deletePlan drops the plan from the store once the server removed it', async () => {
  kvSet(plansKey(USER), JSON.stringify([MONDAY, TUESDAY]));
  mockedRemove.mockResolvedValueOnce({ ok: true });

  await expect(deletePlan(USER, MONDAY)).resolves.toEqual({ ok: true });

  expect(mockedRemove).toHaveBeenCalledWith('p-1');
  expect(readStoredPlans(USER)).toEqual([TUESDAY]);
});

test('usePlans follows every write', async () => {
  const { result } = await renderHook(() => usePlans(USER));
  expect(result.current).toEqual([]);

  mockedList.mockResolvedValueOnce([TUESDAY]);
  await act(async () => {
    await refreshPlans(USER, '2026-11-21');
  });

  expect(result.current).toEqual([TUESDAY]);
  expect(planFor(result.current, '2026-11-24')).toEqual(TUESDAY);
  expect(planFor(result.current, '2026-11-25')).toBeNull();
});

test('account deletion clears the plans; an explicit sign-out drops them as a display cache', () => {
  kvSet(plansKey(USER), JSON.stringify([MONDAY]));
  forgetDisplayCaches(USER);
  expect(kvGet(plansKey(USER))).toBeNull();

  allowUserKeys(USER);
  kvSet(plansKey(USER), JSON.stringify([MONDAY]));
  forgetAccountOnDevice(USER);
  expect(kvGet(plansKey(USER))).toBeNull();
});
