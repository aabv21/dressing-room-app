// Today's "Say the occasion": the dictated words mapped to an occasion by whole-word keywords, in
// the app language (docs/app.md#voice-srcvoice).
import type { Occasion } from '../closet/catalog';
import type { Locale } from '../i18n';

// Checked in this order, so a more specific word wins: "salir a correr" is sport, "cena formal"
// an event, "fiesta en casa" going out and "home office" the office.
const KEYWORDS: Record<Locale, readonly (readonly [Occasion, readonly string[]])[]> = {
  es: [
    ['sport', ['gimnasio', 'gym', 'deporte', 'deportes', 'entrenar', 'entrenamiento', 'correr', 'trotar', 'ejercicio', 'yoga', 'futbol']],
    ['event', ['boda', 'matrimonio', 'evento', 'formal', 'gala', 'ceremonia', 'graduacion', 'grado', 'bautizo', 'quinceanera']],
    ['office', ['trabajo', 'trabajar', 'oficina', 'reunion', 'entrevista', 'negocios']],
    ['university', ['universidad', 'facultad', 'clase', 'clases', 'escuela', 'colegio', 'estudiar']],
    ['going_out', ['fiesta', 'salir', 'salida', 'rumba', 'cita', 'cena', 'amigos', 'bar', 'discoteca']],
    ['home', ['casa', 'hogar', 'quedarme', 'descansar']],
  ],
  en: [
    ['sport', ['gym', 'sport', 'sports', 'workout', 'work out', 'run', 'running', 'jog', 'exercise', 'training', 'yoga', 'soccer']],
    ['event', ['wedding', 'event', 'formal', 'gala', 'ceremony', 'graduation', 'christening', 'baptism']],
    ['office', ['work', 'office', 'meeting', 'interview', 'job', 'business']],
    ['university', ['university', 'college', 'class', 'classes', 'campus', 'school', 'study']],
    ['going_out', ['party', 'going out', 'go out', 'night out', 'date', 'drinks', 'dinner', 'bar', 'club', 'friends']],
    ['home', ['home', 'house', 'stay in', 'staying in', 'relax', 'couch']],
  ],
};

/** Lower case, no accents, letters and spaces only, padded so a keyword matches only whole words. */
function normalize(text: string): string {
  const plain = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return ` ${plain} `;
}

/** The occasion the words name, or null when none of the language's keywords is there. */
export function occasionFromSpeech(text: string, language: Locale): Occasion | null {
  const words = normalize(text);
  if (words.trim() === '') return null;
  const rules = language === 'es' ? KEYWORDS.es : KEYWORDS.en;
  for (const [occasion, keywords] of rules) {
    if (keywords.some((keyword) => words.includes(` ${keyword} `))) return occasion;
  }
  return null;
}
