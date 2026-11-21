// Dictation with the community module expo-speech-recognition: the microphone only after a tap, one
// final result per tap, on the device on iOS when it can (docs/app.md#voice-srcvoice).
import { getLocales } from 'expo-localization';
import { ExpoSpeechRecognitionModule, type ExpoSpeechRecognitionErrorEvent, type ExpoSpeechRecognitionResultEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { useI18n, type Locale } from '../i18n';
import { announceForAccessibility } from '../ui/a11y';

/** The device's own regional variant of the app language (es-CO), else es-MX or en-US. */
export function recognitionLanguage(locale: Locale, deviceTags: readonly string[]): string {
  const own = deviceTags.find((tag) => {
    const [language, region] = tag.split('-');
    return language?.toLowerCase() === locale && region !== undefined;
  });
  return own ?? (locale === 'es' ? 'es-MX' : 'en-US');
}

export type DictationProblem = 'denied' | 'failed' | 'noMatch';

// The recognizer is one per app, and the city modal sits over Today, so only the mic that started
// a session reacts to its events.
let listeningOwner: symbol | null = null;
const listeners = new Set<() => void>();

function setListeningOwner(owner: symbol | null): void {
  listeningOwner = owner;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function recognitionAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/**
 * `onHeard` gets the final transcript; a session that heard nothing sets `problem` to `noMatch`
 * instead. `available` is false when the phone has no recognizer, so the mic stays hidden.
 */
export function useDictation(onHeard: (text: string) => void): {
  available: boolean;
  listening: boolean;
  problem: DictationProblem | null;
  toggle: () => void;
  clearProblem: () => void;
} {
  const { t, locale } = useI18n();
  const [owner] = useState(() => Symbol('dictation'));
  const listening = useSyncExternalStore(subscribe, () => listeningOwner === owner);
  const [available] = useState(recognitionAvailable);
  const [problem, setProblem] = useState<DictationProblem | null>(null);
  const heard = useRef(false);
  const onHeardRef = useRef(onHeard);
  useEffect(() => {
    onHeardRef.current = onHeard;
  });

  useEffect(() => {
    const result = ExpoSpeechRecognitionModule.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
      if (listeningOwner !== owner || !event.isFinal) return;
      const transcript = event.results[0]?.transcript.trim() ?? '';
      if (transcript === '') return;
      heard.current = true;
      onHeardRef.current(transcript);
    });
    const error = ExpoSpeechRecognitionModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
      if (listeningOwner !== owner || event.error === 'aborted') return;
      if (event.error === 'not-allowed') setProblem('denied');
      else if (event.error === 'no-speech' || event.error === 'speech-timeout') setProblem('noMatch');
      else setProblem('failed');
      heard.current = true;
    });
    // `end` always comes last, after a result or an error.
    const end = ExpoSpeechRecognitionModule.addListener('end', () => {
      if (listeningOwner !== owner) return;
      if (!heard.current) setProblem('noMatch');
      setListeningOwner(null);
    });
    return () => {
      result.remove();
      error.remove();
      end.remove();
      if (listeningOwner === owner) {
        setListeningOwner(null);
        ExpoSpeechRecognitionModule.abort();
      }
    };
  }, [owner]);

  const toggle = useCallback(() => {
    if (listeningOwner === owner) {
      // Stop still delivers what was heard so far as the final result.
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    setProblem(null);
    void (async () => {
      let granted = false;
      try {
        granted = (await ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted;
      } catch {
        setProblem('failed');
        return;
      }
      if (!granted) {
        setProblem('denied');
        announceForAccessibility(t('dictate.denied'));
        return;
      }
      if (listeningOwner !== null) ExpoSpeechRecognitionModule.abort();
      heard.current = false;
      setListeningOwner(owner);
      announceForAccessibility(t('dictate.listening'));
      try {
        ExpoSpeechRecognitionModule.start({
          lang: recognitionLanguage(locale, getLocales().map((entry) => entry.languageTag)),
          interimResults: false,
          continuous: false,
          maxAlternatives: 1,
          // On iOS the audio then never leaves the phone; Android's on-device mode needs a language
          // pack download first, so it uses the phone's default recognizer.
          requiresOnDeviceRecognition: Platform.OS === 'ios' && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
        });
      } catch {
        setListeningOwner(null);
        setProblem('failed');
      }
    })();
  }, [owner, locale, t]);

  const clearProblem = useCallback(() => {
    setProblem(null);
  }, []);

  return { available, listening, problem, toggle, clearProblem };
}
