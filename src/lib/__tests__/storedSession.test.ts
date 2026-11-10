import { parseStoredSession } from '../storedSession';

const stored = {
  access_token: 'expired-access-token',
  refresh_token: 'refresh-token',
  expires_at: 1,
  user: { id: 'user-1', email: 'ana@example.com' },
};

test('reads the user id and email of a stored session that still has a refresh token', () => {
  expect(parseStoredSession(JSON.stringify(stored))).toEqual({ userId: 'user-1', email: 'ana@example.com' });
});

test('an account with no email reports null', () => {
  expect(parseStoredSession(JSON.stringify({ ...stored, user: { id: 'user-1' } }))).toEqual({
    userId: 'user-1',
    email: null,
  });
});

test.each([
  ['nothing stored', null],
  ['not JSON', '{oops'],
  ['a JSON scalar', '"text"'],
  ['no refresh token', JSON.stringify({ ...stored, refresh_token: '' })],
  ['no user', JSON.stringify({ ...stored, user: null })],
  ['an empty user id', JSON.stringify({ ...stored, user: { id: '' } })],
])('%s is no session', (_label, raw) => {
  expect(parseStoredSession(raw)).toBeNull();
});
