import type { GarmentCutoutNative } from '../../../../modules/garment-cutout';

// `modules/garment-cutout/index.ts` resolves the native module once, at import time, through
// `expo`'s re-export of expo-modules-core's `requireOptionalNativeModule`. Each test sets what that
// lookup returns, then re-imports the wrapper with a fresh module registry.
const mockRequireOptionalNativeModule = jest.fn<GarmentCutoutNative | null, [string]>();
jest.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) => mockRequireOptionalNativeModule(name),
}));

const isAvailable = jest.fn<boolean, []>();
const cutOut = jest.fn<Promise<string | null>, [string]>();
const fakeNative: GarmentCutoutNative = { isAvailable, cutOut };

async function loadCutOutGarment(native: GarmentCutoutNative | null): Promise<(uri: string) => Promise<string | null>> {
  mockRequireOptionalNativeModule.mockReturnValue(native);
  jest.resetModules();
  const { cutOutGarment } = await import('../cutout');
  return cutOutGarment;
}

beforeEach(() => {
  mockRequireOptionalNativeModule.mockReset();
  isAvailable.mockReset().mockReturnValue(true);
  cutOut.mockReset();
});

test('looks up the native module by its registered name', async () => {
  await loadCutOutGarment(fakeNative);

  expect(mockRequireOptionalNativeModule).toHaveBeenCalledWith('GarmentCutout');
});

test('returns null when the build has no GarmentCutout module', async () => {
  const cutOutGarment = await loadCutOutGarment(null);

  await expect(cutOutGarment('file:///photo.jpg')).resolves.toBeNull();
});

test('returns null without calling cutOut when the platform cannot cut out', async () => {
  isAvailable.mockReturnValue(false);
  const cutOutGarment = await loadCutOutGarment(fakeNative);

  await expect(cutOutGarment('file:///photo.jpg')).resolves.toBeNull();
  expect(cutOut).not.toHaveBeenCalled();
});

test('returns the cut-out PNG URI the native module resolves', async () => {
  cutOut.mockResolvedValue('file:///c.png');
  const cutOutGarment = await loadCutOutGarment(fakeNative);

  await expect(cutOutGarment('file:///photo.jpg')).resolves.toBe('file:///c.png');
  expect(cutOut).toHaveBeenCalledWith('file:///photo.jpg');
});

test('returns null when no subject is found', async () => {
  cutOut.mockResolvedValue(null);
  const cutOutGarment = await loadCutOutGarment(fakeNative);

  await expect(cutOutGarment('file:///photo.jpg')).resolves.toBeNull();
});

test('returns null instead of throwing when the native call rejects', async () => {
  cutOut.mockRejectedValue(new Error('could not create inference context'));
  const cutOutGarment = await loadCutOutGarment(fakeNative);

  await expect(cutOutGarment('file:///photo.jpg')).resolves.toBeNull();
});

test('returns null instead of throwing when isAvailable throws', async () => {
  isAvailable.mockImplementation(() => {
    throw new Error('native crash');
  });
  const cutOutGarment = await loadCutOutGarment(fakeNative);

  await expect(cutOutGarment('file:///photo.jpg')).resolves.toBeNull();
});
