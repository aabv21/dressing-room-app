// Dictation with the community module expo-speech-recognition: the microphone only after a tap, one
// final result per tap, on the device on iOS when it can (docs/app.md#voice-srcvoice).
import { getLocales } from 'expo-localization';
import { ExpoSpeechRecognitionModule, type ExpoSpeechRecognitionErrorEvent, type ExpoSpeechRecognitionResultEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { useI18n, type Locale } from '../i18n';
import { announceForAccessibility } from '../ui/a11y';
import { stopSpeaking } from './speech';

/** The device's own regional variant of the app language (es-CO), else es-MX or en-US. */
export function recognitionLanguage(locale: Locale, deviceTags: readonly string[]): string {
  const own = deviceTags.find((tag) => {
    const [language, region] = tag.split('-');
    return language?.toLowerCase() === locale && region !== undefined;
  });
  return own ?? (locale === 'es' ? 'es-MX' : 'en-US');
}

export type DictationProblem = 'denied' | 'failed' | 'noMatch';

type Session = {
  owner: symbol;
  heard: boolean;
  onHeard: (text: string) => void;
  onProblem: (problem: DictationProblem) => void;
};

// The recognizer is one per app and the city modal sits over Today, so one module-level session says
// which mic owns it. A session handed over or closed is aborted, and its own `end` still arrives
// later: `staleEnds` counts those, and events are ignored until they're through.
let active: Session | null = null;
let staleEnds = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function abortActive(): void {
  if (active === null) return;
  active = null;
  staleEnds += 1;
  notify();
  ExpoSpeechRecognitionModule.abort();
}

function onResult(event: ExpoSpeechRecognitionResultEvent): void {
  if (staleEnds > 0 || active === null || !event.isFinal) return;
  const transcript = event.results[0]?.transcript.trim() ?? '';
  if (transcript === '') return;
  active.heard = true;
  active.onHeard(transcript);
}

function onError(event: ExpoSpeechRecognitionErrorEvent): void {
  if (staleEnds > 0 || active === null || event.error === 'aborted') return;
  active.heard = true;
  if (event.error === 'not-allowed') active.onProblem('denied');
  else if (event.error === 'no-speech' || event.error === 'speech-timeout') active.onProblem('noMatch');
  else active.onProblem('failed');
}

/** `end` always comes last, after a result or an error. */
function onEnd(): void {
  if (staleEnds > 0) {
    staleEnds -= 1;
    return;
  }
  const session = active;
  if (session === null) return;
  active = null;
  notify();
  if (!session.heard) session.onProblem('noMatch');
}

// The native listeners live while any mic is mounted; with none, nothing can arrive late either.
let mounted = 0;
let subscriptions: { remove: () => void }[] = [];

function attach(): void {
  mounted += 1;
  if (mounted > 1) return;
  subscriptions = [
    ExpoSpeechRecognitionModule.addListener('result', onResult),
    ExpoSpeechRecognitionModule.addListener('error', onError),
    ExpoSpeechRecognitionModule.addListener('end', onEnd),
  ];
}

function detach(): void {
  mounted -= 1;
  if (mounted > 0) return;
  for (const subscription of subscriptions) subscription.remove();
  subscriptions = [];
  staleEnds = 0;
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
  const listening = useSyncExternalStore(subscribe, () => active?.owner === owner);
  const [available] = useState(recognitionAvailable);
  const [problem, setProblem] = useState<DictationProblem | null>(null);
  const live = useRef(true);
  const onHeardRef = useRef(onHeard);
  useEffect(() => {
    onHeardRef.current = onHeard;
  });

  useEffect(() => {
    live.current = true;
    attach();
    return () => {
      live.current = false;
      if (active?.owner === owner) abortActive();
      detach();
    };
  }, [owner]);

  const toggle = useCallback(() => {
    if (active?.owner === owner) {
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
        if (live.current) setProblem('failed');
        return;
      }
      // The screen may have closed while the permission prompt was up.
      if (!live.current) return;
      if (!granted) {
        setProblem('denied');
        announceForAccessibility(t('dictate.denied'));
        return;
      }
      // The recognizer would otherwise transcribe the app's own voice.
      stopSpeaking();
      abortActive();
      active = {
        owner,
        heard: false,
        onHeard: (text) => {
          onHeardRef.current(text);
        },
        onProblem: setProblem,
      };
      notify();
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
        active = null;
        notify();
        setProblem('failed');
      }
    })();
  }, [owner, locale, t]);

  const clearProblem = useCallback(() => {
    setProblem(null);
  }, []);

  return { available, listening, problem, toggle, clearProblem };
}
