import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomBytes } from 'expo-crypto';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A nonce pair: the SHA-256 hash goes to the provider (Apple requires it; it lands in the ID
 * token's `nonce` claim), and the raw value to Supabase, which hashes it again to match.
 */
export async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = bytesToHex(getRandomBytes(32));
  const hashed = await digestStringAsync(CryptoDigestAlgorithm.SHA256, raw, {
    encoding: CryptoEncoding.HEX,
  });
  return { raw, hashed };
}
