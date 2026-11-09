/** @jest-environment node */
// supabase/functions/_shared/__tests__/gateway.test.ts
//
// `userIdFromJwt` reads the caller's `sub` without checking the token's signature: the gateway
// verifies it first, but only for a function deployed with `verify_jwt = true`. These tests pin
// that setting in `supabase/config.toml`, so a forged token can never reach a function that
// trusts its `sub` for service-role queries.
import { readdirSync, readFileSync } from 'node:fs';

const FUNCTIONS_DIR = new URL('../../', import.meta.url);

/** The only function the gateway lets through unsigned: the database webhook, which checks its own secret. */
const WEBHOOK_FUNCTIONS = ['extract-attributes'];

function functionNames(): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path inside the repo.
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
}

/** `verify_jwt` per `[functions.<name>]` section; a section without the key maps to null. */
function verifyJwtSettings(): Map<string, boolean | null> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path inside the repo.
  const toml = readFileSync(new URL('../config.toml', FUNCTIONS_DIR), 'utf8');
  const settings = new Map<string, boolean | null>();
  let current: string | null = null;
  for (const line of toml.split('\n')) {
    const section = /^\[([^\]]+)\]\s*$/.exec(line.trim());
    if (section !== null) {
      const name = section[1] ?? '';
      current = name.startsWith('functions.') ? name.slice('functions.'.length) : null;
      if (current !== null) settings.set(current, null);
      continue;
    }
    const setting = /^verify_jwt\s*=\s*(true|false)\s*$/.exec(line.trim());
    if (current !== null && setting !== null) settings.set(current, setting[1] === 'true');
  }
  return settings;
}

describe('the gateway verifies every user-called function’s JWT', () => {
  test('every function directory has a [functions.<name>] section, and no section names a missing one', () => {
    expect([...verifyJwtSettings().keys()].sort()).toEqual(functionNames());
  });

  test.each(functionNames().filter((name) => !WEBHOOK_FUNCTIONS.includes(name)))(
    '%s has verify_jwt = true',
    (name) => {
      expect(verifyJwtSettings().get(name)).toBe(true);
    },
  );

  test('only the database webhook skips the gateway check, and it checks its own secret instead', () => {
    expect(verifyJwtSettings().get('extract-attributes')).toBe(false);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path inside the repo.
    const handler = readFileSync(new URL('extract-attributes/handler.ts', FUNCTIONS_DIR), 'utf8');
    expect(handler).toContain("request.headers.get('x-webhook-secret')");
    expect(handler).not.toContain('userIdFromJwt');
  });
});
