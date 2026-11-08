// integration/garmentRepository.int.test.ts
//
// garmentRepository against the running local stack, signed in as a normal user: both photo
// variants upload and the row is created the way the upload queue does it, signed URLs fetch the
// photos, a photo replacement bumps photo_version, confirming a review stamps reviewed_at, and
// deleting leaves neither the row nor the photos behind. Uploads go through
// `uploadGarmentPhotoBytes` (the same storage call `uploadGarmentPhoto` makes after reading the
// file), since expo-file-system can't load under plain Node.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { signInWithEmail } from '../src/auth/emailAuth';
import {
  bumpPhotoVersion,
  confirmReview,
  deleteGarment,
  garmentPhotoPath,
  insertGarment,
  listGarments,
  signedPhotoUrls,
  uploadGarmentPhotoBytes,
} from '../src/closet/garmentRepository';
import { PermanentUploadError } from '../src/closet/upload/permanentUploadError';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
// A fixed path next to this file, never user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const PHOTO = new Uint8Array(readFileSync(new URL('fixtures/garment.webp', import.meta.url)));

let userId: string;
let client: ReturnType<typeof anonClient>;
const garmentId = randomUUID();

beforeAll(async () => {
  const email = uniqueEmail('garment-repo');
  userId = await createUser(email, PASSWORD);
  client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });

  await uploadGarmentPhotoBytes(userId, garmentId, 'full', PHOTO, client);
  await uploadGarmentPhotoBytes(userId, garmentId, 'thumb', PHOTO, client);
  await insertGarment(garmentId, client);
});

afterAll(async () => {
  try {
    const { data } = await serviceClient().storage.from('garments').list(userId, { limit: 100 });
    const folders = (data ?? []).map((entry) => entry.name);
    const paths = folders.flatMap((folder) => [`${userId}/${folder}/full.webp`, `${userId}/${folder}/thumb.webp`]);
    if (paths.length > 0) {
      await serviceClient().storage.from('garments').remove(paths);
    }
  } finally {
    await deleteUser(userId);
  }
});

test('an uploaded and inserted garment is listed, newest first', async () => {
  const laterId = randomUUID();
  await insertGarment(laterId, client);
  // A retried commit inserts the same id again: still one row.
  await insertGarment(laterId, client);

  const garments = await listGarments(client);

  expect(garments.map((garment) => garment.id)).toEqual([laterId, garmentId]);
  expect(garments[1]).toMatchObject({ id: garmentId, user_id: userId, photo_version: 1 });
});

test('re-uploading a variant overwrites it (upsert) instead of failing', async () => {
  await expect(uploadGarmentPhotoBytes(userId, garmentId, 'thumb', PHOTO, client)).resolves.toBeUndefined();
});

test('signedPhotoUrls gives fetchable URLs for both variants', async () => {
  const paths = [garmentPhotoPath(userId, garmentId, 'full'), garmentPhotoPath(userId, garmentId, 'thumb')];

  const urls = await signedPhotoUrls(paths, client);

  expect([...urls.keys()].sort()).toEqual([...paths].sort());
  for (const url of urls.values()) {
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PHOTO);
  }
});

test('a missing photo is simply absent from signedPhotoUrls', async () => {
  const missing = garmentPhotoPath(userId, randomUUID(), 'thumb');

  const urls = await signedPhotoUrls([missing, garmentPhotoPath(userId, garmentId, 'thumb')], client);

  expect(urls.has(missing)).toBe(false);
  expect(urls.size).toBe(1);
});

test('a photo over the bucket limit is a permanent failure', async () => {
  const tooBig = new Uint8Array(2 * 1024 * 1024 + 1);

  await expect(uploadGarmentPhotoBytes(userId, randomUUID(), 'full', tooBig, client)).rejects.toBeInstanceOf(
    PermanentUploadError,
  );
});

test('bumpPhotoVersion moves 1 to 2', async () => {
  await bumpPhotoVersion({ id: garmentId, photo_version: 1 }, client);

  const { data } = await client.from('garments').select('photo_version').eq('id', garmentId).single();
  expect(data?.photo_version).toBe(2);
});

test('confirmReview saves the patch and stamps reviewed_at', async () => {
  expect(await confirmReview(garmentId, { category: 't_shirt', seasons: ['summer'], formality: 2 }, client)).toEqual({
    ok: true,
  });

  const { data } = await client.from('garments').select('category, seasons, formality, reviewed_at').eq('id', garmentId).single();
  expect(data).toMatchObject({ category: 't_shirt', seasons: ['summer'], formality: 2 });
  expect(data?.reviewed_at).not.toBeNull();
  expect(Math.abs(Date.parse(data?.reviewed_at ?? '') - Date.now())).toBeLessThan(60_000);
});

test('deleteGarment leaves no row and both photos are gone', async () => {
  const paths = [garmentPhotoPath(userId, garmentId, 'full'), garmentPhotoPath(userId, garmentId, 'thumb')];
  const urlsBefore = await signedPhotoUrls(paths, client);
  expect(urlsBefore.size).toBe(2);

  expect(await deleteGarment(userId, garmentId, client)).toEqual({ ok: true });

  const { count } = await serviceClient().from('garments').select('id', { count: 'exact', head: true }).eq('id', garmentId);
  expect(count).toBe(0);
  for (const path of paths) {
    const download = await serviceClient().storage.from('garments').download(path);
    expect(download.data).toBeNull();
    // Storage answers a missing object with HTTP 400 and `statusCode: "404"` in the body.
    expect(download.error).toMatchObject({ statusCode: '404' });
  }
  for (const url of urlsBefore.values()) {
    expect((await fetch(url)).ok).toBe(false);
  }

  // A retry after a lost response finishes cleanly: missing objects and a missing row are fine.
  expect(await deleteGarment(userId, garmentId, client)).toEqual({ ok: true });
});
