// "Listen": text to speech with expo-speech, one utterance at a time app-wide, in the app language
// (docs/app.md#voice-srcvoice).
import * as Speech from 'expo-speech';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';

import { useI18n, type Locale } from '../i18n';

// Neutral Latin American Spanish first, matching the app's copy; Spain's voice only as a fallback.
const SPANISH_TAGS = ['es-mx', 'es-us', 'es-419'];
const ENGLISH_TAGS = ['en-us'];

function tagOf(voice: Speech.Voice): string {
  return voice.language.replaceAll('_', '-').toLowerCase();
}

/** The best installed voice for `locale`, or null when the phone has none in that language. */
export function pickVoice(voices: readonly Speech.Voice[], locale: Locale): Speech.Voice | null {
  const preferred = locale === 'es' ? SPANISH_TAGS : ENGLISH_TAGS;
  const rank = (voice: Speech.Voice): number => {
    const index = preferred.indexOf(tagOf(voice));
    const tier = index === -1 ? preferred.length : index;
    return tier * 2 + (voice.quality === Speech.VoiceQuality.Enhanced ? 0 : 1);
  };
  const candidates = voices.filter((voice) => tagOf(voice).split('-')[0] === locale);
  return candidates.reduce<Speech.Voice | null>((best, voice) => (best === null || rank(voice) < rank(best) ? voice : best), null);
}

// Who is speaking now, so another Listen (or this one's second tap) stops it and each button shows
// its own state. Each utterance has its own token: a late `onStopped` from an earlier one can't
// turn off the button for the one playing now.
let speaking: { owner: symbol; utterance: symbol } | null = null;
const listeners = new Set<() => void>();

function setSpeaking(next: { owner: symbol; utterance: symbol } | null): void {
  speaking = next;
  for (const listener of listeners) listener();
}

/** Stops whatever "Listen" is reading (dictation calls it, so the recognizer never hears the app). */
export function stopSpeaking(): void {
  if (speaking === null) return;
  setSpeaking(null);
  void Speech.stop();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type VoiceState = { status: 'unknown' } | { status: 'none' } | { status: 'ready'; voice: Speech.Voice };

/**
 * `hidden` when the phone lists voices but none in the app language. An empty list (an engine not
 * ready yet) keeps the button, and a speak error then says there's no voice.
 */
export function useSpeaker(text: string): { hidden: boolean; speaking: boolean; toggle: () => void } {
  const { t, locale } = useI18n();
  const focused = useIsFocused();
  const [owner] = useState(() => Symbol('speaker'));
  const isSpeaking = useSyncExternalStore(subscribe, () => speaking?.owner === owner);
  const [voice, setVoice] = useState<VoiceState>({ status: 'unknown' });

  useEffect(() => {
    let live = true;
    Speech.getAvailableVoicesAsync().then(
      (voices) => {
        if (!live) return;
        const picked = pickVoice(voices, locale);
        if (picked !== null) setVoice({ status: 'ready', voice: picked });
        else setVoice({ status: voices.length === 0 ? 'unknown' : 'none' });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [locale]);

  // Leaving the screen, unmounting or new text (another outfit) stops this button's speech.
  useEffect(
    () => () => {
      if (speaking?.owner === owner) stopSpeaking();
    },
    [owner, text, focused],
  );

  const toggle = useCallback(() => {
    if (speaking?.owner === owner) {
      stopSpeaking();
      return;
    }
    // Stops whatever else is reading, so utterances never queue up.
    void Speech.stop();
    const utterance = Symbol('utterance');
    setSpeaking({ owner, utterance });
    const release = (): void => {
      if (speaking?.utterance === utterance) setSpeaking(null);
    };
    Speech.speak(text, {
      language: voice.status === 'ready' ? voice.voice.language.replaceAll('_', '-') : locale,
      ...(voice.status === 'ready' ? { voice: voice.voice.identifier } : {}),
      onDone: release,
      onStopped: release,
      onError: () => {
        release();
        Alert.alert(t('listen.unavailable'));
      },
    });
  }, [owner, text, voice, locale, t]);

  return { hidden: voice.status === 'none', speaking: isSpeaking, toggle };
}
