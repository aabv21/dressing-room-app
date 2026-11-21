import { translate } from '../../i18n';
import { ideaSpeech, ratingSpeech, todaySpeech } from '../speechText';

const en = translate.bind(null, 'en');
const es = translate.bind(null, 'es');

test("Today's outfit: the pieces, the weather line and the occasion, as sentences", () => {
  expect(
    todaySpeech({ pieces: ['Blouse · White', 'Jeans · Blue', 'Sneakers'], weather: 'Sunday · 24 °C, Clear', occasion: 'Office' }, en),
  ).toBe('Blouse, White. Jeans, Blue. Sneakers. Sunday, 24 °C, Clear. Occasion: Office.');
});

test("Today's outfit without weather or an occasion, in Spanish", () => {
  expect(todaySpeech({ pieces: ['Blusa · Blanco', 'Jean · Azul'], weather: null, occasion: null }, es)).toBe(
    'Blusa, Blanco. Jean, Azul.',
  );
  expect(todaySpeech({ pieces: ['Blusa'], weather: null, occasion: 'Salir' }, es)).toBe('Blusa. Ocasión: Salir.');
});

test('the rating: the score with its label, then each reason', () => {
  expect(ratingSpeech({ score: 82, label: 'Looks good', reasons: ['The colors work together.', 'Shoes match the occasion'] }, en)).toBe(
    'Score 82 out of 100: Looks good. The colors work together. Shoes match the occasion.',
  );
  expect(ratingSpeech({ score: 45, label: 'Puede mejorar', reasons: [] }, es)).toBe('Puntaje 45 de 100: Puede mejorar.');
});

test("For you: the idea's name and its line", () => {
  expect(ideaSpeech({ name: 'Blazer · Camel', line: 'Goes with 6 of your pieces!' })).toBe(
    'Blazer, Camel. Goes with 6 of your pieces!',
  );
  expect(ideaSpeech({ name: 'Blazer · Camel', line: null })).toBe('Blazer, Camel.');
});
