jest.mock('../../lib/supabase', () => ({
  supabase: { auth: {} },
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn(function File(this: { uri: string; bytes: () => Promise<Uint8Array> }, uri: string) {
    this.uri = uri;
    this.bytes = () => Promise.resolve(new Uint8Array([1, 2, 3]));
  }),
}));

import { File } from 'expo-file-system';

import { PermanentUploadError } from '../upload/permanentUploadError';
import {
  bumpPhotoVersion,
  confirmReview,
  deleteGarment,
  garmentPhotoPath,
  insertGarment,
  listGarments,
  signedPhotoUrls,
  updateGarment,
  uploadGarmentPhoto,
} from '../garmentRepository';

type Client = NonNullable<Parameters<typeof listGarments>[0]>;

/** Records every call in order, so tests can assert what ran before what. */
const calls: string[] = [];

function fakeClient(
  options: {
    upload?: { data: unknown; error: unknown };
    remove?: { data: unknown; error: unknown };
    signed?: { data: unknown; error: unknown };
    rows?: { data: unknown; error: unknown; status?: number };
  } = {},
) {
  const upload = jest.fn(() => {
    calls.push('storage.upload');
    return Promise.resolve(options.upload ?? { data: { path: 'p' }, error: null });
  });
  const remove = jest.fn(() => {
    calls.push('storage.remove');
    return Promise.resolve(options.remove ?? { data: [], error: null });
  });
  const createSignedUrls = jest.fn(() => Promise.resolve(options.signed ?? { data: [], error: null }));
  const storageFrom = jest.fn(() => ({ upload, remove, createSignedUrls }));

  const rows = options.rows ?? { data: [{ id: 'g-1' }], error: null, status: 200 };
  const settled = () => Promise.resolve({ status: 200, ...rows });
  // A chainable PostgREST-ish builder: every filter returns itself, and awaiting it settles `rows`.
  const builder: Record<string, jest.Mock> = Object.assign(
    {
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => settled().then(resolve, reject),
    },
    Object.fromEntries(
      ['select', 'eq', 'order', 'update', 'upsert', 'delete'].map((method) => [
        method,
        jest.fn(() => {
          calls.push(`db.${method}`);
          return builder;
        }),
      ]),
    ),
  );
  const from = jest.fn(() => builder);

  return {
    client: { from, storage: { from: storageFrom } } as unknown as Client,
    from,
    builder,
    storageFrom,
    upload,
    remove,
    createSignedUrls,
  };
}

beforeEach(() => {
  calls.length = 0;
});

test('garmentPhotoPath puts each variant under the user and garment', () => {
  expect(garmentPhotoPath('user-1', 'g-1', 'full')).toBe('user-1/g-1/full.webp');
  expect(garmentPhotoPath('user-1', 'g-1', 'thumb')).toBe('user-1/g-1/thumb.webp');
});

test('listGarments reads newest first and throws on error', async () => {
  const { client, from, builder } = fakeClient({ rows: { data: [{ id: 'g-2' }, { id: 'g-1' }], error: null } });

  expect(await listGarments(client)).toEqual([{ id: 'g-2' }, { id: 'g-1' }]);
  expect(from).toHaveBeenCalledWith('garments');
  expect(builder['order']).toHaveBeenCalledWith('created_at', { ascending: false });

  const failing = fakeClient({ rows: { data: null, error: new Error('boom') } });
  await expect(listGarments(failing.client)).rejects.toThrow('boom');
});

test('signedPhotoUrls signs for an hour and skips entries with an error or no path', async () => {
  const { client, storageFrom, createSignedUrls } = fakeClient({
    signed: {
      data: [
        { path: 'u/a/thumb.webp', signedUrl: 'http://x/a', error: null },
        { path: 'u/b/thumb.webp', signedUrl: '', error: 'Either the object does not exist or you do not have access to it' },
        { path: null, signedUrl: 'http://x/c', error: null },
      ],
      error: null,
    },
  });

  const urls = await signedPhotoUrls(['u/a/thumb.webp', 'u/b/thumb.webp'], client);

  expect(storageFrom).toHaveBeenCalledWith('garments');
  expect(createSignedUrls).toHaveBeenCalledWith(['u/a/thumb.webp', 'u/b/thumb.webp'], 3600);
  expect(urls).toEqual(new Map([['u/a/thumb.webp', 'http://x/a']]));
});

test('signedPhotoUrls makes no request for no paths', async () => {
  const { client, createSignedUrls } = fakeClient();

  expect(await signedPhotoUrls([], client)).toEqual(new Map());
  expect(createSignedUrls).not.toHaveBeenCalled();
});

describe('uploadGarmentPhoto', () => {
  test("reads the file's bytes and upserts them as WebP at the variant's path", async () => {
    const { client, upload } = fakeClient();

    await uploadGarmentPhoto('user-1', 'g-1', 'thumb', 'file:///document/uploads/t.webp', client);

    expect(File).toHaveBeenCalledWith('file:///document/uploads/t.webp');
    expect(upload).toHaveBeenCalledWith('user-1/g-1/thumb.webp', expect.any(ArrayBuffer), {
      contentType: 'image/webp',
      upsert: true,
    });
    const body = (upload.mock.calls[0] as unknown[] | undefined)?.[1] as ArrayBuffer;
    expect(Array.from(new Uint8Array(body))).toEqual([1, 2, 3]);
  });

  test('a 413 is permanent', async () => {
    const { client } = fakeClient({
      upload: { data: null, error: Object.assign(new Error('Payload too large'), { status: 413, statusCode: '413' }) },
    });

    await expect(uploadGarmentPhoto('user-1', 'g-1', 'full', 'file:///f.webp', client)).rejects.toBeInstanceOf(
      PermanentUploadError,
    );
  });

  test.each([408, 429, 500, 503])('a %i is retried, not permanent', async (status) => {
    const error = Object.assign(new Error('nope'), { status, statusCode: String(status) });
    const { client } = fakeClient({ upload: { data: null, error } });

    const outcome = uploadGarmentPhoto('user-1', 'g-1', 'full', 'file:///f.webp', client);

    await expect(outcome).rejects.toBe(error);
  });

  test("storage's HTTP 400 carrying a 413 in the body is permanent", async () => {
    const error = Object.assign(new Error('The object exceeded the maximum allowed size'), {
      status: 400,
      statusCode: '413',
    });
    const { client } = fakeClient({ upload: { data: null, error } });

    await expect(uploadGarmentPhoto('user-1', 'g-1', 'full', 'file:///f.webp', client)).rejects.toBeInstanceOf(
      PermanentUploadError,
    );
  });

  test("storage's HTTP 400 carrying a 429 in the body is retried", async () => {
    const error = Object.assign(new Error('Too many requests'), { status: 400, statusCode: '429' });
    const { client } = fakeClient({ upload: { data: null, error } });

    await expect(uploadGarmentPhoto('user-1', 'g-1', 'full', 'file:///f.webp', client)).rejects.toBe(error);
  });

  test('a body statusCode is trusted only when HTTP is 400: an HTTP 500 with a body of 404 is retried', async () => {
    const error = Object.assign(new Error('Internal error'), { status: 500, statusCode: '404' });
    const { client } = fakeClient({ upload: { data: null, error } });

    await expect(uploadGarmentPhoto('user-1', 'g-1', 'full', 'file:///f.webp', client)).rejects.toBe(error);
  });

  test.each([401, 403])('a %i (an expired or swapped session) is retried, not permanent', async (status) => {
    const error = Object.assign(new Error('Unauthorized'), { status, statusCode: String(status) });
    const { client } = fakeClient({ upload: { data: null, error } });

    await expect(uploadGarmentPhoto('user-1', 'g-1', 'full', 'file:///f.webp', client)).rejects.toBe(error);
  });

  test("storage's HTTP 400 carrying a 403 in the body (RLS) is retried", async () => {
    const error = Object.assign(new Error('new row violates row-level security policy'), { status: 400, statusCode: '403' });
    const { client } = fakeClient({ upload: { data: null, error } });

    await expect(uploadGarmentPhoto('user-1', 'g-1', 'full', 'file:///f.webp', client)).rejects.toBe(error);
  });

  test('a network failure (no status) is retried, not permanent', async () => {
    const error = Object.assign(new Error('Network request failed'), { status: undefined, statusCode: undefined });
    const { client } = fakeClient({ upload: { data: null, error } });

    await expect(uploadGarmentPhoto('user-1', 'g-1', 'full', 'file:///f.webp', client)).rejects.toBe(error);
  });
});

test('insertGarment sends the id and the owner, and ignores a duplicate', async () => {
  const { client, builder } = fakeClient();

  await insertGarment('g-1', 'user-1', client);

  expect(builder['upsert']).toHaveBeenCalledWith(
    { id: 'g-1', user_id: 'user-1' },
    { onConflict: 'id', ignoreDuplicates: true },
  );
});

test('insertGarment throws on error', async () => {
  const { client } = fakeClient({ rows: { data: null, error: new Error('denied') } });

  await expect(insertGarment('g-1', 'user-1', client)).rejects.toThrow('denied');
});

test("an RLS rejection (another account's session) is retryable, never permanent", async () => {
  const rlsError = { code: '42501', message: 'new row violates row-level security policy for table "garments"' };
  const { client } = fakeClient({ rows: { data: null, error: rlsError, status: 403 } });

  const outcome = await insertGarment('g-1', 'user-1', client).then(
    () => null,
    (error: unknown) => error,
  );

  expect(outcome).toBe(rlsError);
  expect(outcome).not.toBeInstanceOf(PermanentUploadError);
});

test('bumpPhotoVersion writes the next version for that garment', async () => {
  const { client, builder } = fakeClient();

  await bumpPhotoVersion({ id: 'g-1', photo_version: 3 }, client);

  expect(builder['update']).toHaveBeenCalledWith({ photo_version: 4 });
  expect(builder['eq']).toHaveBeenCalledWith('id', 'g-1');
});

describe('updateGarment and confirmReview', () => {
  test('updateGarment writes the patch to that garment', async () => {
    const { client, builder } = fakeClient();

    expect(await updateGarment('g-1', { status: 'laundry' }, client)).toEqual({ ok: true });
    expect(builder['update']).toHaveBeenCalledWith({ status: 'laundry' });
    expect(builder['eq']).toHaveBeenCalledWith('id', 'g-1');
  });

  test('an update that reaches no row is an error', async () => {
    const { client } = fakeClient({ rows: { data: [], error: null } });

    expect(await updateGarment('g-1', { status: 'laundry' }, client)).toEqual({ ok: false, error: 'unknown' });
  });

  test('a rejected value maps to invalid, a fetch failure to network', async () => {
    const invalid = fakeClient({ rows: { data: null, error: { code: '23514', message: 'check' }, status: 400 } });
    expect(await updateGarment('g-1', { formality: 9 }, invalid.client)).toEqual({ ok: false, error: 'invalid' });

    const offline = fakeClient({ rows: { data: null, error: { code: '', message: 'TypeError' }, status: 0 } });
    expect(await updateGarment('g-1', { formality: 2 }, offline.client)).toEqual({ ok: false, error: 'network' });
  });

  test("confirmReview stamps reviewed_at with the server's clock", async () => {
    const { client, builder } = fakeClient();

    expect(await confirmReview('g-1', { category: 't_shirt', seasons: ['summer'] }, client)).toEqual({ ok: true });
    expect(builder['update']).toHaveBeenCalledWith({ category: 't_shirt', seasons: ['summer'], reviewed_at: 'now' });
  });
});

describe('deleteGarment', () => {
  test('removes both photos before the row', async () => {
    const { client, remove, builder } = fakeClient();

    expect(await deleteGarment('user-1', 'g-1', client)).toEqual({ ok: true });

    expect(remove).toHaveBeenCalledWith(['user-1/g-1/full.webp', 'user-1/g-1/thumb.webp']);
    expect(builder['eq']).toHaveBeenCalledWith('id', 'g-1');
    expect(calls).toEqual(['storage.remove', 'db.delete', 'db.eq']);
  });

  test('a network failure removing the photos keeps the row and reports network', async () => {
    const { client, builder } = fakeClient({
      remove: { data: null, error: Object.assign(new Error('Network request failed'), { status: undefined, statusCode: undefined }) },
    });

    expect(await deleteGarment('user-1', 'g-1', client)).toEqual({ ok: false, error: 'network' });
    expect(builder['delete']).not.toHaveBeenCalled();
  });

  test('a thrown network error removing the photos keeps the row too', async () => {
    const { client, builder, remove } = fakeClient();
    remove.mockImplementation(() => {
      throw new TypeError('Network request failed');
    });

    expect(await deleteGarment('user-1', 'g-1', client)).toEqual({ ok: false, error: 'network' });
    expect(builder['delete']).not.toHaveBeenCalled();
  });

  test('a row delete that fails offline reports network', async () => {
    const { client } = fakeClient({ rows: { data: null, error: { code: '', message: 'offline' }, status: 0 } });

    expect(await deleteGarment('user-1', 'g-1', client)).toEqual({ ok: false, error: 'network' });
  });
});
