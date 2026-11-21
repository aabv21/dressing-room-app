import { recognitionLanguage } from '../dictation';

test("the device's own regional tag in the app language comes first", () => {
  expect(recognitionLanguage('es', ['es-CO', 'en-US'])).toBe('es-CO');
  expect(recognitionLanguage('en', ['es-CO', 'en-GB'])).toBe('en-GB');
});

test('otherwise Mexican Spanish or US English', () => {
  expect(recognitionLanguage('es', ['en-US'])).toBe('es-MX');
  expect(recognitionLanguage('en', ['es-CO'])).toBe('en-US');
  expect(recognitionLanguage('es', ['es'])).toBe('es-MX');
});
