// integration/garments.int.test.ts
//
// `public.garments` and the garment photo folder through supabase-js, the way the app reaches them:
// user B gets zero rows or an error, never A's data; a repeated insert of the same id (an upload
// retried after the app was killed) leaves one row; and the extraction state is server-only.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { signInWithEmail } from '../src/auth/emailAuth';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
// A fixed path next to this file, never user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const PHOTO = readFileSync(new URL('fixtures/garment.webp', import.meta.url));

let userAId: string;
let userBId: string;
let clientA: ReturnType<typeof anonClient>;
let clientB: ReturnType<typeof anonClient>;
const garmentId = randomUUID();
const uploadedPaths: string[] = [];

beforeAll(async () => {
  const emailA = uniqueEmail('garments-user-a');
  const emailB = uniqueEmail('garments-user-b');
  userAId = await createUser(emailA, PASSWORD);
  userBId = await createUser(emailB, PASSWORD);
  clientA = anonClient();
  clientB = anonClient();
  expect(await signInWithEmail(emailA, PASSWORD, clientA)).toEqual({ ok: true });
  expect(await signInWithEmail(emailB, PASSWORD, clientB)).toEqual({ ok: true });

  const photoPath = `${userAId}/${garmentId}/full.webp`;
  const upload = await clientA.storage.from('garments').upload(photoPath, PHOTO, { contentType: 'image/webp' });
  expect(upload.error).toBeNull();
  uploadedPaths.push(photoPath);

  const insert = await clientA.from('garments').insert({ id: garmentId });
  expect(insert.error).toBeNull();
});

afterAll(async () => {
  await serviceClient().storage.from('garments').remove(uploadedPaths);
  await Promise.all([deleteUser(userAId), deleteUser(userBId)]);
});

test("B can't select, update or delete A's garment", async () => {
  const selected = await clientB.from('garments').select('id').eq('id', garmentId);
  expect(selected.error).toBeNull();
  expect(selected.data).toEqual([]);

  const updated = await clientB.from('garments').update({ status: 'lent' }).eq('id', garmentId).select('id');
  expect(updated.error).toBeNull();
  expect(updated.data).toEqual([]);

  const deleted = await clientB.from('garments').delete().eq('id', garmentId).select('id');
  expect(deleted.error).toBeNull();
  expect(deleted.data).toEqual([]);

  const { data: row } = await serviceClient().from('garments').select('user_id, status').eq('id', garmentId).single();
  expect(row).toEqual({ user_id: userAId, status: 'available' });
});

test("B can't download A's photo or upload into A's folder", async () => {
  const download = await clientB.storage.from('garments').download(`${userAId}/${garmentId}/full.webp`);
  expect(download.data).toBeNull();
  expect(download.error).not.toBeNull();

  const intruderPath = `${userAId}/${randomUUID()}/full.webp`;
  const upload = await clientB.storage.from('garments').upload(intruderPath, PHOTO, { contentType: 'image/webp' });
  expect(upload.error).not.toBeNull();
  uploadedPaths.push(intruderPath);
});

test('inserting the same id twice with ignoreDuplicates leaves one row', async () => {
  const id = randomUUID();
  const first = await clientA.from('garments').upsert({ id }, { onConflict: 'id', ignoreDuplicates: true });
  const second = await clientA.from('garments').upsert({ id }, { onConflict: 'id', ignoreDuplicates: true });
  expect(first.error).toBeNull();
  expect(second.error).toBeNull();

  const { count, error } = await serviceClient().from('garments').select('id', { count: 'exact', head: true }).eq('id', id);
  expect(error).toBeNull();
  expect(count).toBe(1);
});

test('a client update of extraction_status errors', async () => {
  const { error } = await clientA.from('garments').update({ extraction_status: 'done' }).eq('id', garmentId);

  expect(error?.code).toBe('42501');
});
