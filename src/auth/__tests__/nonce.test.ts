import { createHash } from 'node:crypto';

import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomBytes } from 'expo-crypto';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  getRandomBytes: jest.fn(),
  digestStringAsync: jest.fn(),
}));

import { createNonce } from '../nonce';

const mockGetRandomBytes = getRandomBytes as jest.MockedFunction<typeof getRandomBytes>;
const mockDigestStringAsync = digestStringAsync as jest.MockedFunction<typeof digestStringAsync>;

beforeEach(() => {
  jest.clearAllMocks();
});

test('raw is 64 hex characters derived from 32 random bytes', async () => {
  const bytes = new Uint8Array(32).fill(0xab);
  mockGetRandomBytes.mockReturnValue(bytes);
  mockDigestStringAsync.mockResolvedValue('deterministic-digest');

  const { raw } = await createNonce();

  expect(raw).toHaveLength(64);
  expect(raw).toBe('ab'.repeat(32));
  expect(mockGetRandomBytes).toHaveBeenCalledWith(32);
});

test('hashed equals the SHA-256 hex digest of raw', async () => {
  const bytes = new Uint8Array(32).fill(0x01);
  mockGetRandomBytes.mockReturnValue(bytes);
  const expectedRaw = '01'.repeat(32);
  const expectedDigest = createHash('sha256').update(expectedRaw).digest('hex');
  mockDigestStringAsync.mockResolvedValue(expectedDigest);

  const { raw, hashed } = await createNonce();

  expect(mockDigestStringAsync).toHaveBeenCalledWith(CryptoDigestAlgorithm.SHA256, raw, {
    encoding: CryptoEncoding.HEX,
  });
  expect(hashed).toBe(expectedDigest);
});
