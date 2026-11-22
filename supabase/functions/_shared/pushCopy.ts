// The push notices' copy in the profile's language; the app's own strings live in src/i18n.

export type PushLanguage = 'en' | 'es';
export type PushCopy = { title: string; body: string };

/** The profile language, English when unset or unknown. */
export function pushLanguageOf(value: unknown): PushLanguage {
  return value === 'es' ? 'es' : 'en';
}

export function reviewReadyCopy(language: PushLanguage, count: number): PushCopy {
  const n = String(count);
  if (language === 'es') {
    return {
      title: count === 1 ? '1 prenda lista para revisar' : `${n} prendas listas para revisar`,
      body: 'Toca para confirmar sus datos.',
    };
  }
  return {
    title: count === 1 ? '1 garment is ready to review' : `${n} garments are ready to review`,
    body: 'Tap to confirm their details.',
  };
}

export function weeklySummaryCopy(language: PushLanguage, outfits: number, unused: number): PushCopy {
  const o = String(outfits);
  const u = String(unused);
  if (language === 'es') {
    const logged = outfits === 1 ? '1 outfit registrado' : `${o} outfits registrados`;
    const waiting = unused === 1 ? '1 prenda esperando a que la uses' : `${u} prendas esperando a que las uses`;
    return { title: 'Tu semana', body: `Esta semana: ${logged} · ${waiting}` };
  }
  const logged = outfits === 1 ? '1 outfit logged' : `${o} outfits logged`;
  const waiting = unused === 1 ? '1 piece waiting to be worn' : `${u} pieces waiting to be worn`;
  return { title: 'Your week', body: `This week: ${logged} · ${waiting}` };
}
