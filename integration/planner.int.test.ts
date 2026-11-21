// integration/planner.int.test.ts
//
// The planner's repository against the local stack: `plan_outfit` through supabase-js (one plan per
// day, own garments only, the 14-day window), `listPlans` under RLS (another user sees nothing) and
// `removePlan`; the saved-trips repository the same way.

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signInWithEmail } from '../src/auth/emailAuth';
import type { Database } from '../src/lib/database.types';
import { listPlans, planOutfit, removePlan } from '../src/planner/plannedOutfits';
import { deleteSavedTrip, listSavedTrips, saveTrip } from '../src/trips/savedTrips';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, uniqueEmail } from './helpers';

loadIntegrationEnv();

type Client = SupabaseClient<Database>;
type User = { id: string; client: Client; garmentIds: string[] };

const PASSWORD = 'Password123!';
const users: User[] = [];

const today = (): string => new Date().toISOString().slice(0, 10);
const daysFrom = (n: number): string => new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function userWithGarments(label: string): Promise<User> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  const garmentIds = [randomUUID(), randomUUID(), randomUUID()];
  for (const garmentId of garmentIds) expect((await client.from('garments').insert({ id: garmentId })).error).toBeNull();
  const user = { id, client, garmentIds };
  users.push(user);
  return user;
}

let a: User;
let b: User;

beforeAll(async () => {
  a = await userWithGarments('planner-a');
  b = await userWithGarments('planner-b');
});

afterAll(async () => {
  await Promise.all(users.map((user) => deleteUser(user.id)));
});

test('a plan for a day is stored, replaced by the next one for that day, and listed by day', async () => {
  const first = await planOutfit({ day: daysFrom(2), garmentIds: a.garmentIds.slice(0, 2), occasion: 'office' }, a.client);
  expect(first.ok).toBe(true);
  const second = await planOutfit({ day: daysFrom(2), garmentIds: a.garmentIds.slice(1), occasion: null }, a.client);
  expect(second).toEqual({ ok: true, plan: { id: first.ok ? first.plan.id : '', day: daysFrom(2), garmentIds: a.garmentIds.slice(1), occasion: null } });
  expect((await planOutfit({ day: today(), garmentIds: a.garmentIds.slice(0, 2), occasion: null }, a.client)).ok).toBe(true);

  const plans = await listPlans(today(), daysFrom(13), a.client);

  expect(plans.map((plan) => [plan.day, plan.garmentIds])).toEqual([
    [today(), a.garmentIds.slice(0, 2)],
    [daysFrom(2), a.garmentIds.slice(1)],
  ]);
});

test('another user’s garment, a day in the past or past the window are refused as invalid', async () => {
  expect(await planOutfit({ day: daysFrom(1), garmentIds: [a.garmentIds[0] ?? '', b.garmentIds[0] ?? ''], occasion: null }, a.client)).toEqual({
    ok: false,
    error: 'invalid',
  });
  expect(await planOutfit({ day: daysFrom(-3), garmentIds: a.garmentIds.slice(0, 2), occasion: null }, a.client)).toEqual({ ok: false, error: 'invalid' });
  expect(await planOutfit({ day: daysFrom(20), garmentIds: a.garmentIds.slice(0, 2), occasion: null }, a.client)).toEqual({ ok: false, error: 'invalid' });
});

test('another user lists none of the plans and can’t remove one; the owner can', async () => {
  const [plan] = await listPlans(today(), daysFrom(13), a.client);
  expect(plan).toBeDefined();

  expect(await listPlans(today(), daysFrom(13), b.client)).toEqual([]);
  await removePlan(plan?.id ?? '', b.client);
  expect(await listPlans(today(), daysFrom(13), a.client)).toHaveLength(2);

  expect(await removePlan(plan?.id ?? '', a.client)).toEqual({ ok: true });
  expect(await listPlans(today(), daysFrom(13), a.client)).toHaveLength(1);
});

test('saved trips: saved with the snapshot, listed only to the owner, deleted by the owner', async () => {
  const result = { kind: 'ok' as const, city: 'Lisboa', days: [{ date: daysFrom(5), weather: null, garmentIds: a.garmentIds }], packing: [] };

  const saved = await saveTrip({ city: 'Lisboa', start: daysFrom(5), end: daysFrom(7), occasion: 'going_out', result }, a.client);

  expect(saved.ok).toBe(true);
  const trips = await listSavedTrips(a.client);
  expect(trips).toEqual([{ id: saved.ok ? saved.trip.id : '', city: 'Lisboa', start: daysFrom(5), end: daysFrom(7), occasion: 'going_out', result }]);
  expect(await listSavedTrips(b.client)).toEqual([]);
  expect(await deleteSavedTrip(trips[0]?.id ?? '', a.client)).toEqual({ ok: true });
  expect(await listSavedTrips(a.client)).toEqual([]);
});
