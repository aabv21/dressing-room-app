import { kvGetJson, kvRemove, kvSet, parseJson } from '../kv';

const isPair = (value: unknown): value is { a: number } =>
  typeof value === 'object' && value !== null && typeof (value as { a?: unknown }).a === 'number';

afterEach(() => {
  kvRemove('test.json');
});

test('kvGetJson reads a stored value that passes the guard', () => {
  kvSet('test.json', '{"a":1}');
  expect(kvGetJson('test.json', isPair)).toEqual({ a: 1 });
});

test('kvGetJson is null for a missing key, invalid JSON or a guard miss', () => {
  expect(kvGetJson('test.json', isPair)).toBeNull();
  kvSet('test.json', 'not json');
  expect(kvGetJson('test.json', isPair)).toBeNull();
  kvSet('test.json', '{"a":"1"}');
  expect(kvGetJson('test.json', isPair)).toBeNull();
});

test('parseJson reads a raw value the same way', () => {
  expect(parseJson('{"a":2}', isPair)).toEqual({ a: 2 });
  expect(parseJson(null, isPair)).toBeNull();
  expect(parseJson('{', isPair)).toBeNull();
});
