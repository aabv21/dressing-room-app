import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomBytes } from 'expo-crypto';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates the raw/hashed nonce pair used by Sign in with Apple and Google: the hashed value is
 * sent to the provider (Apple requires the SHA-256 hash; `signInWithIdToken` verifies it against
 * the ID token's `nonce` claim), and the raw value is sent to Supabase so it can redo that hash
 * and match it.
 */
export async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = bytesToHex(getRandomBytes(32));
  const hashed = await digestStringAsync(CryptoDigestAlgorithm.SHA256, raw, {
    encoding: CryptoEncoding.HEX,
  });
  return { raw, hashed };
}
