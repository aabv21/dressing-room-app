// Mapped over `src/lib/supabase.ts` for the `integration` project (docs/testing.md#integration): the real one
// loads native modules, and every test passes its own client, so any use of the default path throws.

/** Same idea for `emailAuth.signOut`'s default storage cleanup: never meant to run here. */
export function clearPersistedAuth(): never {
  throw new Error(
    'integration/lib-supabase.stub.ts: `clearPersistedAuth` was used — the default client\'s storage does not exist in integration tests.',
  );
}

/** Same idea for `emailAuth.storedSessionUserId`'s default reader: never meant to run here. */
export function readStoredSession(): never {
  throw new Error(
    'integration/lib-supabase.stub.ts: `readStoredSession` was used — the default client\'s storage does not exist in integration tests.',
  );
}

export const supabase = new Proxy(
  {},
  {
    get(): never {
      throw new Error(
        'integration/lib-supabase.stub.ts: `supabase` was used, but no integration test should rely on ' +
          'the default client — pass an explicit client (anonClient()/serviceClient() from ./helpers) instead.',
      );
    },
  },
);
