// integration/lib-supabase.stub.ts
//
// Stands in for `src/lib/supabase.ts` under the `integration` Jest project (see jest.config.ts's
// `moduleNameMapper`). The real module imports `react-native` and
// `expo-sqlite/localStorage/install`, native modules that cannot load under plain Node — and even
// if it could load, reading `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` from
// `process.env` here would silently pick up whatever `.env.local` happens to hold, which is not
// what an integration test wants as its default client.
//
// Every `integration/*.int.test.ts` call to `emailAuth.ts`/`socialAuth.ts` passes its own client
// built by `helpers.ts` (`anonClient()`/`serviceClient()`), so the default-parameter path
// (`client: Client = supabase`) should never actually run here. If it ever does, fail loudly and
// specifically rather than let a `TypeError` on `undefined.auth` or a real native-module crash
// obscure what went wrong.

/** Same idea for `emailAuth.signOut`'s default storage cleanup: never meant to run here. */
export function clearPersistedAuth(): never {
  throw new Error(
    'integration/lib-supabase.stub.ts: `clearPersistedAuth` was used — the default client\'s storage does not exist in integration tests.',
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
