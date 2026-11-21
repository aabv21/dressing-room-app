import { storeLinksFor } from '../storeLinks';

const Q = 'blazer camel mujer';

const names = (region: string | null) => storeLinksFor(region, Q, 'es').map((link) => link.name);

describe('the stores for each region', () => {
  test.each([
    ['CO', ['Falabella', 'Mercado Libre', 'Google Shopping']],
    ['MX', ['Mercado Libre', 'Google Shopping']],
    ['AR', ['Mercado Libre', 'Google Shopping']],
    ['CL', ['Falabella', 'Mercado Libre', 'Google Shopping']],
    ['PE', ['Falabella', 'Mercado Libre']],
    ['BR', ['Mercado Livre']],
    ['US', ['Google Shopping', 'Google']],
    ['VE', ['Google Shopping', 'Google']],
  ])('%s: %j', (region, expected) => {
    expect(names(region)).toEqual(expected);
  });

  test('no region, or a lower-case one, still works', () => {
    expect(names(null)).toEqual(['Google Shopping', 'Google']);
    expect(names('co')).toEqual(['Falabella', 'Mercado Libre', 'Google Shopping']);
  });
});

describe('the search URLs', () => {
  test('Colombia', () => {
    expect(storeLinksFor('CO', Q, 'es')).toEqual([
      { id: 'falabella', name: 'Falabella', url: 'https://www.falabella.com.co/falabella-co/search?Ntt=blazer%20camel%20mujer' },
      { id: 'mercadolibre', name: 'Mercado Libre', url: 'https://listado.mercadolibre.com.co/blazer-camel-mujer' },
      {
        id: 'google_shopping',
        name: 'Google Shopping',
        url: 'https://www.google.com/search?tbm=shop&q=blazer%20camel%20mujer&hl=es&gl=co',
      },
    ]);
  });

  test("each country's own Falabella and Mercado Libre site", () => {
    const url = (region: string, id: string) => storeLinksFor(region, Q, 'es').find((link) => link.id === id)?.url;
    expect(url('MX', 'mercadolibre')).toBe('https://listado.mercadolibre.com.mx/blazer-camel-mujer');
    expect(url('AR', 'mercadolibre')).toBe('https://listado.mercadolibre.com.ar/blazer-camel-mujer');
    expect(url('CL', 'mercadolibre')).toBe('https://listado.mercadolibre.cl/blazer-camel-mujer');
    expect(url('CL', 'falabella')).toBe('https://www.falabella.com/falabella-cl/search?Ntt=blazer%20camel%20mujer');
    expect(url('PE', 'mercadolibre')).toBe('https://listado.mercadolibre.com.pe/blazer-camel-mujer');
    expect(url('PE', 'falabella')).toBe('https://www.falabella.com.pe/falabella-pe/search?Ntt=blazer%20camel%20mujer');
    expect(url('BR', 'mercadolivre')).toBe('https://lista.mercadolivre.com.br/blazer-camel-mujer');
  });

  test('elsewhere: Google Shopping and Google in the app language', () => {
    expect(storeLinksFor('US', 'camel blazer women', 'en')).toEqual([
      {
        id: 'google_shopping',
        name: 'Google Shopping',
        url: 'https://www.google.com/search?tbm=shop&q=camel%20blazer%20women&hl=en&gl=us',
      },
      { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=camel%20blazer%20women&hl=en' },
    ]);
    expect(storeLinksFor(null, 'camel blazer women', 'en')[0]?.url).toBe(
      'https://www.google.com/search?tbm=shop&q=camel%20blazer%20women&hl=en',
    );
  });

  test('every query is encoded: spaces, ampersands, question marks and accents never reach the URL raw', () => {
    const query = 'suéter a&b c?d#e';
    for (const region of ['CO', 'MX', 'CL', 'PE', 'BR', 'US']) {
      for (const { url } of storeLinksFor(region, query, 'es')) {
        const parsed = new URL(url);
        expect(url).not.toMatch(/[ é#]/);
        expect(url).toContain('su%C3%A9ter');
        expect(url).toContain('a%26b');
        expect(url).toContain('c%3Fd%23e');
        const param = parsed.searchParams.get('q') ?? parsed.searchParams.get('Ntt');
        if (param !== null) expect(param).toBe(query);
      }
    }
  });

  test('Mercado Libre joins the words with hyphens, its own URL style', () => {
    expect(storeLinksFor('MX', '  white   sneakers ', 'en')[0]?.url).toBe('https://listado.mercadolibre.com.mx/white-sneakers');
  });

  test("Google Shopping's region parameter is encoded too", () => {
    expect(storeLinksFor('x&y=z', 'tee', 'en')[0]?.url).toBe('https://www.google.com/search?tbm=shop&q=tee&hl=en&gl=x%26y%3Dz');
  });
});
