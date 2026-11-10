jest.mock('../garmentRepository', () => ({
  garmentPhotoPath: (userId: string, garmentId: string, variant: string) => `${userId}/${garmentId}/${variant}.webp`,
  signedPhotoUrls: jest.fn(),
}));

import { act, render, screen, waitFor } from '@testing-library/react-native';

import { GarmentPhoto } from '../GarmentPhoto';
import { signedPhotoUrls } from '../garmentRepository';

const mockedSign = jest.mocked(signedPhotoUrls);

/** A promise the test settles by hand, to hold a signing request in flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function photoSource(): unknown {
  return screen.getByLabelText('Garment photo').props.source;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('signs the full photo once and caches it by photo_version', async () => {
  mockedSign.mockResolvedValue(new Map([['user-1/g-1/full.webp', 'https://signed/v1']]));

  await render(<GarmentPhoto garment={{ id: 'g-1', user_id: 'user-1', photo_version: 1 }} />);

  await waitFor(() => {
    expect(photoSource()).toEqual([expect.objectContaining({ uri: 'https://signed/v1', cacheKey: 'g-1:full:1' })]);
  });
  expect(mockedSign).toHaveBeenCalledTimes(1);
  expect(mockedSign).toHaveBeenCalledWith(['user-1/g-1/full.webp']);
});

test('a new photo_version signs again, and the old URL is never shown under the new version', async () => {
  mockedSign.mockResolvedValueOnce(new Map([['user-1/g-1/full.webp', 'https://signed/v1']]));
  const view = await render(<GarmentPhoto garment={{ id: 'g-1', user_id: 'user-1', photo_version: 1 }} />);
  await waitFor(() => {
    expect(photoSource()).toEqual([expect.objectContaining({ uri: 'https://signed/v1' })]);
  });

  const resigning = deferred<Map<string, string>>();
  mockedSign.mockReturnValueOnce(resigning.promise);
  await view.rerender(<GarmentPhoto garment={{ id: 'g-1', user_id: 'user-1', photo_version: 2 }} />);

  expect(mockedSign).toHaveBeenCalledTimes(2);
  // Same storage path, so the old URL could still serve the old photo from an HTTP or CDN cache.
  expect(screen.queryByLabelText('Garment photo')).toBeNull();

  await act(async () => {
    resigning.resolve(new Map([['user-1/g-1/full.webp', 'https://signed/v2']]));
    await resigning.promise;
  });
  expect(photoSource()).toEqual([expect.objectContaining({ uri: 'https://signed/v2', cacheKey: 'g-1:full:2' })]);
});
