jest.mock('../../../lib/supabase', () => ({ supabase: { auth: {} } }));
jest.mock('../preparePhoto', () => ({ preparePhoto: jest.fn() }));
jest.mock('../../garmentRepository', () => ({
  garmentPhotoPath: (userId: string, garmentId: string, variant: string) => `${userId}/${garmentId}/${variant}.webp`,
  uploadGarmentPhoto: jest.fn(() => Promise.resolve()),
  insertGarment: jest.fn(() => Promise.resolve()),
  bumpPhotoVersion: jest.fn(() => Promise.resolve()),
}));

import { bumpPhotoVersion, insertGarment, uploadGarmentPhoto } from '../../garmentRepository';
import { preparePhoto } from '../preparePhoto';
import type { QueueItem } from '../queueStore';
import { createQueueSteps } from '../queueSteps';

type Client = NonNullable<Parameters<typeof createQueueSteps>[0]>;

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    garmentId: 'g-1',
    userId: 'user-1',
    replace: false,
    sourceUri: 'file:///document/uploads/g-1-source.jpg',
    stage: 'uploaded',
    fullUri: 'file:///document/uploads/full.webp',
    thumbUri: 'file:///document/uploads/thumb.webp',
    attempts: 0,
    nextAttemptAt: 0,
    failed: false,
    createdAt: 0,
    ...overrides,
  };
}

/** A client whose garment row read resolves `row`, and whose storage `remove` resolves `removeError`. */
function fakeClient(row: { data: unknown; error: unknown }, removeError: unknown = null) {
  const maybeSingle = jest.fn(() => Promise.resolve(row));
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const remove = jest.fn(() => Promise.resolve({ data: [], error: removeError }));
  const client = {
    from: jest.fn(() => ({ select })),
    storage: { from: jest.fn(() => ({ remove })) },
  } as unknown as Client;
  return { client, select, eq, remove };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('prepare runs preparePhoto on the source', async () => {
  jest.mocked(preparePhoto).mockResolvedValue({ fullUri: 'f', thumbUri: 't' });
  const steps = createQueueSteps(fakeClient({ data: null, error: null }).client);

  expect(await steps.prepare('file:///document/uploads/g-1-source.jpg')).toEqual({ fullUri: 'f', thumbUri: 't' });
  expect(preparePhoto).toHaveBeenCalledWith('file:///document/uploads/g-1-source.jpg');
});

test('upload sends both variants', async () => {
  const { client } = fakeClient({ data: null, error: null });
  const steps = createQueueSteps(client);

  await steps.upload({ ...makeItem({ stage: 'prepared' }), fullUri: 'file:///f.webp', thumbUri: 'file:///t.webp' });

  expect(uploadGarmentPhoto).toHaveBeenCalledWith('user-1', 'g-1', 'full', 'file:///f.webp', client);
  expect(uploadGarmentPhoto).toHaveBeenCalledWith('user-1', 'g-1', 'thumb', 'file:///t.webp', client);
});

test('commit inserts a new garment', async () => {
  const { client } = fakeClient({ data: null, error: null });

  await createQueueSteps(client).commit(makeItem());

  expect(insertGarment).toHaveBeenCalledWith('g-1', client);
  expect(bumpPhotoVersion).not.toHaveBeenCalled();
});

test("commit for a replacement bumps the current row's photo version", async () => {
  const { client, select, eq } = fakeClient({ data: { id: 'g-1', photo_version: 2 }, error: null });

  await createQueueSteps(client).commit(makeItem({ replace: true }));

  expect(select).toHaveBeenCalledWith('id, photo_version');
  expect(eq).toHaveBeenCalledWith('id', 'g-1');
  expect(bumpPhotoVersion).toHaveBeenCalledWith({ id: 'g-1', photo_version: 2 }, client);
  expect(insertGarment).not.toHaveBeenCalled();
});

test('a replacement for a garment deleted meanwhile removes the uploaded photos instead', async () => {
  const { client, remove } = fakeClient({ data: null, error: null });

  await createQueueSteps(client).commit(makeItem({ replace: true }));

  expect(remove).toHaveBeenCalledWith(['user-1/g-1/full.webp', 'user-1/g-1/thumb.webp']);
  expect(bumpPhotoVersion).not.toHaveBeenCalled();
  expect(insertGarment).not.toHaveBeenCalled();
});

test('a failed row read is thrown, so the queue retries the commit', async () => {
  const error = new Error('offline');
  const { client } = fakeClient({ data: null, error });

  await expect(createQueueSteps(client).commit(makeItem({ replace: true }))).rejects.toBe(error);
  expect(bumpPhotoVersion).not.toHaveBeenCalled();
});
