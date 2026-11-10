// Store-search words for the For you ideas, in English and Spanish. The functions have no i18n
// catalog, so this is a small word map over the catalog enums only; the Spanish words follow the
// app's `garment.category.*` and `garment.color.*` labels, lowercased, with the color agreeing in
// gender and number with the garment ("camisa blanca", "jeans negros").
//
// Runtime-neutral (only `catalog.ts` imported).

import type { ClothingType, GarmentCategory, GarmentColor } from './catalog.ts';

export type Language = 'en' | 'es';

const EN_CATEGORY: Record<GarmentCategory, string> = {
  t_shirt: 't-shirt',
  blouse: 'blouse',
  shirt: 'shirt',
  polo: 'polo shirt',
  tank_top: 'tank top',
  sweater: 'sweater',
  hoodie: 'hoodie',
  cardigan: 'cardigan',
  pants: 'pants',
  jeans: 'jeans',
  shorts: 'shorts',
  skirt: 'skirt',
  leggings: 'leggings',
  dress: 'dress',
  jumpsuit: 'jumpsuit',
  jacket: 'jacket',
  blazer: 'blazer',
  coat: 'coat',
  vest: 'vest',
  sneakers: 'sneakers',
  shoes: 'shoes',
  heels: 'heels',
  flats: 'flats',
  sandals: 'sandals',
  boots: 'boots',
  loafers: 'loafers',
  bag: 'bag',
  hat: 'hat',
  belt: 'belt',
  scarf: 'scarf',
  tie: 'tie',
  jewelry: 'jewelry',
  sunglasses: 'sunglasses',
  watch: 'watch',
  accessory: 'accessory',
};

/** The noun's grammatical form: `m`/`f` for gender, a trailing `p` for a plural noun ("jeans"). */
type EsForm = 'm' | 'f' | 'mp' | 'fp';

const ES_CATEGORY: Record<GarmentCategory, readonly [word: string, form: EsForm]> = {
  t_shirt: ['franela', 'f'],
  blouse: ['blusa', 'f'],
  shirt: ['camisa', 'f'],
  polo: ['polo', 'm'],
  tank_top: ['camiseta sin mangas', 'f'],
  sweater: ['suéter', 'm'],
  hoodie: ['suéter con capucha', 'm'],
  cardigan: ['cárdigan', 'm'],
  pants: ['pantalón', 'm'],
  jeans: ['jeans', 'mp'],
  shorts: ['shorts', 'mp'],
  skirt: ['falda', 'f'],
  leggings: ['leggings', 'mp'],
  dress: ['vestido', 'm'],
  jumpsuit: ['enterizo', 'm'],
  jacket: ['chaqueta', 'f'],
  blazer: ['blazer', 'm'],
  coat: ['abrigo', 'm'],
  vest: ['chaleco', 'm'],
  sneakers: ['tenis', 'mp'],
  shoes: ['zapatos', 'mp'],
  heels: ['tacones', 'mp'],
  flats: ['baletas', 'fp'],
  sandals: ['sandalias', 'fp'],
  boots: ['botas', 'fp'],
  loafers: ['mocasines', 'mp'],
  bag: ['bolso', 'm'],
  hat: ['sombrero', 'm'],
  belt: ['cinturón', 'm'],
  scarf: ['bufanda', 'f'],
  tie: ['corbata', 'f'],
  jewelry: ['joyería', 'f'],
  sunglasses: ['gafas de sol', 'fp'],
  watch: ['reloj', 'm'],
  accessory: ['accesorio', 'm'],
};

const EN_COLOR: Record<GarmentColor, string> = {
  black: 'black',
  white: 'white',
  gray: 'gray',
  navy: 'navy',
  blue: 'blue',
  light_blue: 'light blue',
  red: 'red',
  burgundy: 'burgundy',
  pink: 'pink',
  purple: 'purple',
  green: 'green',
  olive: 'olive',
  yellow: 'yellow',
  orange: 'orange',
  brown: 'brown',
  camel: 'camel',
  beige: 'beige',
  cream: 'cream',
  gold: 'gold',
  silver: 'silver',
};

/** A color that inflects: its four forms. A plain string never changes ("camel", "azul marino"). */
type EsInflected = Record<EsForm, string>;

const inflect = (stem: string): EsInflected => ({ m: `${stem}o`, f: `${stem}a`, mp: `${stem}os`, fp: `${stem}as` });
const pluralOnly = (word: string, plural: string): EsInflected => ({ m: word, f: word, mp: plural, fp: plural });

const ES_COLOR: Record<GarmentColor, string | EsInflected> = {
  black: inflect('negr'),
  white: inflect('blanc'),
  gray: pluralOnly('gris', 'grises'),
  navy: 'azul marino',
  blue: pluralOnly('azul', 'azules'),
  light_blue: 'azul claro',
  red: inflect('roj'),
  burgundy: 'vinotinto',
  pink: inflect('rosad'),
  purple: inflect('morad'),
  green: pluralOnly('verde', 'verdes'),
  olive: 'verde oliva',
  yellow: inflect('amarill'),
  orange: 'naranja',
  brown: 'café',
  camel: 'camel',
  beige: 'beige',
  cream: 'crema',
  gold: inflect('dorad'),
  silver: inflect('platead'),
};

const EN_CATEGORIES = new Map(Object.entries(EN_CATEGORY));
const ES_CATEGORIES = new Map(Object.entries(ES_CATEGORY));
const EN_COLORS = new Map(Object.entries(EN_COLOR));
const ES_COLORS = new Map(Object.entries(ES_COLOR));

/** The store-search noun for a category ("blazer", "franela"). */
export function categoryTerm(category: GarmentCategory, language: Language): string {
  return (language === 'es' ? ES_CATEGORIES.get(category)?.[0] : EN_CATEGORIES.get(category)) ?? category;
}

/** The store-search adjective for a color, agreeing with the category in Spanish ("camisa blanca"). */
export function colorTerm(color: GarmentColor, category: GarmentCategory, language: Language): string {
  if (language === 'en') return EN_COLORS.get(color) ?? color;
  const word = ES_COLORS.get(color);
  if (word === undefined) return color;
  if (typeof word === 'string') return word;
  switch (ES_CATEGORIES.get(category)?.[1] ?? 'm') {
    case 'm':
      return word.m;
    case 'f':
      return word.f;
    case 'mp':
      return word.mp;
    case 'fp':
      return word.fp;
  }
}

/** "women"/"mujer" or "men"/"hombre"; empty for `everything`, which shops both. */
export function audienceTerm(clothingType: ClothingType, language: Language): string {
  if (clothingType === 'everything') return '';
  if (clothingType === 'feminine') return language === 'es' ? 'mujer' : 'women';
  return language === 'es' ? 'hombre' : 'men';
}
