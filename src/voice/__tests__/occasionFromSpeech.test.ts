import { occasionFromSpeech } from '../occasionFromSpeech';

test.each([
  ['trabajo', 'office'],
  ['Mañana tengo una reunión en la oficina', 'office'],
  ['clase en la universidad', 'university'],
  ['me voy de fiesta', 'going_out'],
  ['quiero salir con amigos', 'going_out'],
  ['me quedo en casa', 'home'],
  ['una boda', 'event'],
  ['cena formal el sábado', 'event'],
  ['voy al gimnasio', 'sport'],
  ['salir a correr', 'sport'],
  ['fiesta en casa', 'going_out'],
  ['REUNIÓN', 'office'],
  ['futbol', 'sport'],
] as const)('es: "%s" is %s', (text, occasion) => {
  expect(occasionFromSpeech(text, 'es')).toBe(occasion);
});

test.each([
  ['work', 'office'],
  ['a meeting at the office', 'office'],
  ['class at college', 'university'],
  ['a party tonight', 'going_out'],
  ['going out for drinks', 'going_out'],
  ['staying home', 'home'],
  ['a wedding', 'event'],
  ['formal dinner on Saturday', 'event'],
  ['gym', 'sport'],
  ['work out', 'sport'],
  ['Home office', 'office'],
] as const)('en: "%s" is %s', (text, occasion) => {
  expect(occasionFromSpeech(text, 'en')).toBe(occasion);
});

test('whole words only: "networking" is not work, "classic" is not class', () => {
  expect(occasionFromSpeech('networking', 'en')).toBeNull();
  expect(occasionFromSpeech('a classic look', 'en')).toBeNull();
});

test('nothing recognizable gives null', () => {
  expect(occasionFromSpeech('', 'es')).toBeNull();
  expect(occasionFromSpeech('   ', 'en')).toBeNull();
  expect(occasionFromSpeech('azul marino', 'es')).toBeNull();
  expect(occasionFromSpeech('banana', 'en')).toBeNull();
});

test("each language's own words: Spanish words don't count in English", () => {
  expect(occasionFromSpeech('fiesta', 'en')).toBeNull();
  expect(occasionFromSpeech('party', 'es')).toBeNull();
});
