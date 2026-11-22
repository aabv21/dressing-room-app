import { VoiceQuality, type Voice } from 'expo-speech';

import { pickVoice } from '../speech';

function voice(identifier: string, language: string, quality: VoiceQuality = VoiceQuality.Default): Voice {
  return { identifier, name: identifier, language, quality };
}

test('Spanish prefers a Latin American voice over Spain', () => {
  const voices = [voice('es-es', 'es-ES'), voice('es-us', 'es-US'), voice('en', 'en-US')];
  expect(pickVoice(voices, 'es')?.identifier).toBe('es-us');
});

test('Mexican Spanish comes first, and Android-style tags with an underscore match too', () => {
  const voices = [voice('es-us', 'es_US'), voice('es-mx', 'es_MX'), voice('es-es', 'es-ES')];
  expect(pickVoice(voices, 'es')?.identifier).toBe('es-mx');
});

test('any Spanish voice when no Latin American one exists', () => {
  expect(pickVoice([voice('es-es', 'es-ES'), voice('en', 'en-GB')], 'es')?.identifier).toBe('es-es');
});

test('English prefers en-US, then any English', () => {
  expect(pickVoice([voice('gb', 'en-GB'), voice('us', 'en-US')], 'en')?.identifier).toBe('us');
  expect(pickVoice([voice('gb', 'en-GB'), voice('es', 'es-MX')], 'en')?.identifier).toBe('gb');
});

test('an enhanced voice wins within the same language tag', () => {
  const voices = [voice('plain', 'en-US'), voice('enhanced', 'en-US', VoiceQuality.Enhanced)];
  expect(pickVoice(voices, 'en')?.identifier).toBe('enhanced');
});

test('no voice in the language gives null', () => {
  expect(pickVoice([voice('en', 'en-US')], 'es')).toBeNull();
  expect(pickVoice([], 'en')).toBeNull();
});
