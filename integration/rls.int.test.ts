// integration/rls.int.test.ts
//
// Verifies the cross-user RLS boundary (Review Focus #1 in global-constraints.md) actually holds
// against a running Postgres, not just in pgTAP: two signed-in anon clients, A can only ever see
// or touch A's own `profiles` row and `garments` storage objects.

import { signInWithEmail } from '../src/auth/emailAuth';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
const createdUserIds: string[] = [];

let userAId: string;
let userBId: string;
let clientA: ReturnType<typeof anonClient>;
let clientB: ReturnType<typeof anonClient>;

beforeAll(async () => {
  const emailA = uniqueEmail('rls-user-a');
  const emailB = uniqueEmail('rls-user-b');
  userAId = await createUser(emailA, PASSWORD);
  userBId = await createUser(emailB, PASSWORD);
  createdUserIds.push(userAId, userBId);

  clientA = anonClient();
  clientB = anonClient();
  const signInA = await signInWithEmail(emailA, PASSWORD, clientA);
  const signInB = await signInWithEmail(emailB, PASSWORD, clientB);
  expect(signInA).toEqual({ ok: true });
  expect(signInB).toEqual({ ok: true });
});

const uploadedStoragePaths: string[] = [];

afterAll(async () => {
  if (uploadedStoragePaths.length > 0) {
    await serviceClient().storage.from('garments').remove(uploadedStoragePaths);
  }
  await Promise.all(createdUserIds.map((id) => deleteUser(id)));
});

test("A's select on profiles returns only A's own row", async () => {
  const { data, error } = await clientA.from('profiles').select('*');

  expect(error).toBeNull();
  expect(data).not.toBeNull();
  expect(data?.map((row) => row.user_id)).toEqual([userAId]);
});

test("A's update targeting B's row changes nothing", async () => {
  const { data, error } = await clientA.from('profiles').update({ city_name: 'Hijacked' }).eq('user_id', userBId).select();

  expect(error).toBeNull();
  // RLS silently filters out rows the policy doesn't allow touching, rather than erroring: the
  // update affects zero rows, which `.select()` surfaces as an empty array (not B's row).
  expect(data).toEqual([]);

  const { data: bRow, error: bRowError } = await serviceClient().from('profiles').select('*').eq('user_id', userBId).single();
  expect(bRowError).toBeNull();
  expect(bRow).not.toBeNull();
  expect(bRow?.city_name).not.toBe('Hijacked');
});

test("A can upload to A's own folder but not to B's", async () => {
  const payload = Buffer.from('fake-webp-bytes');

  const ownUpload = await clientA.storage
    .from('garments')
    .upload(`${userAId}/test.webp`, payload, { contentType: 'image/webp' });
  expect(ownUpload.error).toBeNull();
  uploadedStoragePaths.push(`${userAId}/test.webp`);

  const crossUpload = await clientA.storage
    .from('garments')
    .upload(`${userBId}/test.webp`, payload, { contentType: 'image/webp' });
  expect(crossUpload.error).not.toBeNull();
});

test("A can't download B's object", async () => {
  const payload = Buffer.from('bs-owned-bytes');
  const bUpload = await clientB.storage
    .from('garments')
    .upload(`${userBId}/private.webp`, payload, { contentType: 'image/webp' });
  expect(bUpload.error).toBeNull();
  uploadedStoragePaths.push(`${userBId}/private.webp`);

  const { data, error } = await clientA.storage.from('garments').download(`${userBId}/private.webp`);

  expect(data).toBeNull();
  expect(error).not.toBeNull();
});
