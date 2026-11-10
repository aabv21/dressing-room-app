// integration/rls.int.test.ts
//
// Verifies the cross-user RLS boundary actually holds against a running Postgres, not just in
// pgTAP: two signed-in anon clients, A can only ever see or touch A's own `profiles` row and
// `garments` storage objects. Also pins what a user can't do to their own row (insert, delete) and
// the bucket's upload limits.

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

test("A's insert into profiles is rejected, even for A's own id (the signup trigger creates the row)", async () => {
  const { error } = await clientA.from('profiles').insert({ user_id: userAId });

  expect(error?.code).toBe('42501');
});

test('A cannot delete their own profile row (there is no delete policy)', async () => {
  const { data, error } = await clientA.from('profiles').delete().eq('user_id', userAId).select();

  expect(error).toBeNull();
  expect(data).toEqual([]);
  const { data: row } = await serviceClient().from('profiles').select('user_id').eq('user_id', userAId).single();
  expect(row?.user_id).toBe(userAId);
});

test("A can neither list B's folder nor delete B's object", async () => {
  const path = `${userBId}/keep.webp`;
  const bUpload = await clientB.storage.from('garments').upload(path, Buffer.from('b-bytes'), { contentType: 'image/webp' });
  expect(bUpload.error).toBeNull();
  uploadedStoragePaths.push(path);

  const listed = await clientA.storage.from('garments').list(userBId);
  expect(listed.error).toBeNull();
  expect(listed.data).toEqual([]);

  const removed = await clientA.storage.from('garments').remove([path]);
  expect(removed.error).toBeNull();
  expect(removed.data).toEqual([]);

  const stillThere = await serviceClient().storage.from('garments').list(userBId);
  expect(stillThere.data?.map((entry) => entry.name)).toContain('keep.webp');
});

test('an upload with a MIME type outside the three image types is rejected', async () => {
  const { error } = await clientA.storage
    .from('garments')
    .upload(`${userAId}/notes.txt`, Buffer.from('plain text'), { contentType: 'text/plain' });

  expect(error).not.toBeNull();
  uploadedStoragePaths.push(`${userAId}/notes.txt`);
});

test('an upload over the 2 MiB limit is rejected, and one at the limit is accepted', async () => {
  const limit = 2 * 1024 * 1024;

  const tooBig = await clientA.storage
    .from('garments')
    .upload(`${userAId}/too-big.webp`, Buffer.alloc(limit + 1), { contentType: 'image/webp' });
  expect(tooBig.error).not.toBeNull();
  uploadedStoragePaths.push(`${userAId}/too-big.webp`);

  const atLimit = await clientA.storage
    .from('garments')
    .upload(`${userAId}/at-limit.webp`, Buffer.alloc(limit), { contentType: 'image/webp' });
  expect(atLimit.error).toBeNull();
  uploadedStoragePaths.push(`${userAId}/at-limit.webp`);
});
