// What "Listen" reads aloud on Today, the rating and For you: the screen's text as short sentences.
import type { MessageKey } from '../i18n';

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

/** A label's " · " separator read as a pause, not as "middle dot". */
function speakable(label: string): string {
  return label.replaceAll(' · ', ', ');
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function sentences(parts: readonly (string | null)[]): string {
  return parts
    .filter((part): part is string => part !== null && part.trim() !== '')
    .map(sentence)
    .join(' ');
}

export function todaySpeech(
  outfit: { pieces: readonly string[]; weather: string | null; occasion: string | null },
  t: Translate,
): string {
  return sentences([
    ...outfit.pieces.map(speakable),
    outfit.weather === null ? null : speakable(outfit.weather),
    outfit.occasion === null ? null : t('listen.occasion', { occasion: outfit.occasion }),
  ]);
}

export function ratingSpeech(rating: { score: number; label: string; reasons: readonly string[] }, t: Translate): string {
  return sentences([t('listen.score', { score: rating.score, label: rating.label }), ...rating.reasons]);
}

export function ideaSpeech(idea: { name: string; line: string | null }): string {
  return sentences([speakable(idea.name), idea.line]);
}
