// For you's "Search in stores": the stores that sell online in the device's region, each as a search
// URL for the idea's query (docs/app.md#outfits-srcoutfits).
import type { Locale } from '../i18n';

export type StoreId = 'falabella' | 'mercadolibre' | 'mercadolivre' | 'google_shopping' | 'google';

export type StoreLink = { id: StoreId; name: string; url: string };

const NAMES: ReadonlyMap<StoreId, string> = new Map([
  ['falabella', 'Falabella'],
  ['mercadolibre', 'Mercado Libre'],
  ['mercadolivre', 'Mercado Livre'],
  ['google_shopping', 'Google Shopping'],
  ['google', 'Google'],
]);

/** Each region's stores in the order shown; any other region gets `FALLBACK`. */
const STORES_BY_REGION: ReadonlyMap<string, readonly StoreId[]> = new Map([
  ['CO', ['falabella', 'mercadolibre', 'google_shopping']],
  ['MX', ['mercadolibre', 'google_shopping']],
  ['AR', ['mercadolibre', 'google_shopping']],
  ['CL', ['falabella', 'mercadolibre', 'google_shopping']],
  ['PE', ['falabella', 'mercadolibre']],
  ['BR', ['mercadolivre']],
]);
const FALLBACK: readonly StoreId[] = ['google_shopping', 'google'];

const FALABELLA_SEARCH: ReadonlyMap<string, string> = new Map([
  ['CO', 'https://www.falabella.com.co/falabella-co/search?Ntt='],
  ['CL', 'https://www.falabella.com/falabella-cl/search?Ntt='],
  ['PE', 'https://www.falabella.com.pe/falabella-pe/search?Ntt='],
]);
const MERCADO_LIBRE_SEARCH: ReadonlyMap<string, string> = new Map([
  ['CO', 'https://listado.mercadolibre.com.co/'],
  ['MX', 'https://listado.mercadolibre.com.mx/'],
  ['AR', 'https://listado.mercadolibre.com.ar/'],
  ['CL', 'https://listado.mercadolibre.cl/'],
  ['PE', 'https://listado.mercadolibre.com.pe/'],
]);
const MERCADO_LIVRE_SEARCH = 'https://lista.mercadolivre.com.br/';

/** Fixed hosts plus the encoded query only, so nothing in the query can change where a link goes. */
function storeUrl(store: StoreId, region: string | null, query: string, language: Locale): string | null {
  // NOTE: no affiliate tags, so no referral income; upgrade path: append each program's tag here once the owner joins Falabella Creators F or Mercado Libre's.
  const q = encodeURIComponent(query);
  // Mercado Libre's own listing URLs join the words with hyphens.
  const words = query.split(/\s+/).map(encodeURIComponent).join('-');
  switch (store) {
    case 'falabella': {
      const base = region === null ? undefined : FALABELLA_SEARCH.get(region);
      return base === undefined ? null : `${base}${q}`;
    }
    case 'mercadolibre': {
      const base = region === null ? undefined : MERCADO_LIBRE_SEARCH.get(region);
      return base === undefined ? null : `${base}${words}`;
    }
    case 'mercadolivre':
      return `${MERCADO_LIVRE_SEARCH}${words}`;
    case 'google_shopping':
      return `https://www.google.com/search?tbm=shop&q=${q}&hl=${language}${region === null ? '' : `&gl=${encodeURIComponent(region.toLowerCase())}`}`;
    case 'google':
      return `https://www.google.com/search?q=${q}&hl=${language}`;
  }
}

/** The stores for `region` (expo-localization's `regionCode`, any case), each with its search URL. */
export function storeLinksFor(region: string | null, query: string, language: Locale): StoreLink[] {
  const code = region === null ? null : region.toUpperCase();
  const stores = (code === null ? undefined : STORES_BY_REGION.get(code)) ?? FALLBACK;
  const trimmed = query.trim();
  return stores.flatMap((id) => {
    const url = storeUrl(id, code, trimmed, language);
    const name = NAMES.get(id);
    return url === null || name === undefined ? [] : [{ id, name, url }];
  });
}
