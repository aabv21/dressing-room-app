// The For you tab: 3–5 "what you're missing" ideas from `for-you`, each with "Search in stores".
// Rendered directly with auth, focus and the AI client mocked; kv is the in-memory test store.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Speech from 'expo-speech';
import { Alert, Linking } from 'react-native';

import ForYouScreen from '../app/(tabs)/for-you';
import { I18nProvider } from '../i18n/I18nProvider';
import { kvGet, kvRemove, kvSet } from '../lib/kv';
import { fetchForYou, type AiOutcome } from '../outfits/aiClient';
import { storedForYouKey, storeForYou } from '../outfits/storedForYou';
import type { ForYouCard, ForYouResponse } from '../outfits/types';

const mockFocus = { focused: true };
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useIsFocused: () => mockFocus.focused,
}));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'user-1' }),
}));

jest.mock('../outfits/aiClient', () => ({
  fetchForYou: jest.fn(),
}));
jest.mock('../lib/localDate', () => ({ localDate: () => '2026-11-20' }));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- the share and store sheets read Reduce Motion; see src/test/reanimatedMock.ts's module doc
jest.mock('react-native-reanimated', () => require('../test/reanimatedMock'));
const mockRegion: { code: string | null } = { code: 'US' };
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: mockRegion.code, currencyCode: 'USD' }],
}));

const mockedFetch = jest.mocked(fetchForYou);
const mockedPush = jest.mocked(router.push);

const BLAZER: ForYouCard = {
  id: 'blazer-camel',
  category: 'blazer',
  colors: ['camel'],
  newOutfits: 14,
  combinesWith: 8,
  line: 'A camel blazer dresses up every pair of jeans you own.',
  lineKey: null,
  lineParams: {},
  searchQuery: 'camel blazer women',
};

const SNEAKERS: ForYouCard = {
  id: 'sneakers-white',
  category: 'sneakers',
  colors: ['white'],
  newOutfits: 1,
  combinesWith: 3,
  line: null,
  lineKey: 'forYou.line.shoes',
  lineParams: {},
  searchQuery: 'white sneakers women',
};

const IDEAS: ForYouResponse = { kind: 'ok', ideas: [BLAZER, SNEAKERS] };

function ok(response: ForYouResponse): Promise<AiOutcome<ForYouResponse>> {
  return Promise.resolve({ ok: true, result: response });
}

function failed(error: 'network' | 'over_quota' | 'unknown'): Promise<AiOutcome<ForYouResponse>> {
  return Promise.resolve({ ok: false, error });
}

async function renderIn(locale: 'en' | 'es'): Promise<void> {
  kvSet('locale-preference', locale);
  await render(
    <I18nProvider>
      <ForYouScreen />
    </I18nProvider>,
  );
}

let openURL: jest.SpyInstance;

beforeEach(() => {
  mockFocus.focused = true;
  mockRegion.code = 'US';
  mockedFetch.mockReset();
  mockedPush.mockClear();
  kvRemove(storedForYouKey('user-1'));
  openURL = jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve());
  // A spy restored in afterEach is the same function next time: start each test with no calls.
  openURL.mockClear();
});

afterEach(() => {
  kvSet('locale-preference', 'system');
  jest.restoreAllMocks();
});

describe('the ideas', () => {
  test("render as cards: name, combines line, Claude's line and the template line through i18n", async () => {
    mockedFetch.mockReturnValue(ok(IDEAS));
    await render(<ForYouScreen />);

    expect(await screen.findByText('Blazer · Camel')).toBeOnTheScreen();
    expect(screen.getByText('FOR YOU')).toBeOnTheScreen();
    expect(screen.getByText('Combines with 8 of your items (+14 outfits)')).toBeOnTheScreen();
    expect(screen.getByText('A camel blazer dresses up every pair of jeans you own.')).toBeOnTheScreen();
    expect(screen.getByText('Sneakers · White')).toBeOnTheScreen();
    expect(screen.getByText('Combines with 3 of your items (+1 outfit)')).toBeOnTheScreen();
    expect(screen.getByText("Finishes outfits you can't complete today.")).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /^Search in stores/ })).toHaveLength(2);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith({ language: 'en', date: '2026-11-20' });
  });

  test('render in Spanish, and "Buscar en tiendas" lists the stores; Google opens the encoded search with hl=es', async () => {
    const es: ForYouResponse = {
      kind: 'ok',
      ideas: [{ ...BLAZER, line: null, lineKey: 'forYou.line.outerwear', searchQuery: 'blazer camel mujer' }],
    };
    mockedFetch.mockReturnValue(ok(es));
    await renderIn('es');

    expect(await screen.findByText('Combina con 8 de tus prendas (+14 outfits)')).toBeOnTheScreen();
    expect(screen.getByText('PARA TI')).toBeOnTheScreen();
    expect(screen.getByText('Ponla sobre los outfits que ya usas para completarlos.')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenCalledWith({ language: 'es', date: '2026-11-20' });

    await fireEvent.press(screen.getByRole('button', { name: /^Buscar en tiendas/ }));
    expect(openURL).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Google Shopping' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Google' }));

    expect(openURL).toHaveBeenCalledWith('https://www.google.com/search?q=blazer%20camel%20mujer&hl=es');
    expect(screen.queryByRole('button', { name: 'Google Shopping' })).not.toBeOnTheScreen();
  });

  test("in Colombia the sheet lists Falabella, Mercado Libre and Google Shopping, each opening its search", async () => {
    mockRegion.code = 'CO';
    mockedFetch.mockReturnValue(ok({ kind: 'ok', ideas: [{ ...BLAZER, searchQuery: 'blazer camel mujer' }] }));
    await renderIn('es');

    await fireEvent.press(await screen.findByRole('button', { name: /^Buscar en tiendas/ }));

    const sheet = screen.getByTestId('store-sheet');
    expect(within(sheet).getByText('Blazer · Camel')).toBeOnTheScreen();
    expect(within(sheet).getAllByRole('button').map((button) => button.props.accessibilityLabel as string)).toEqual([
      'Falabella',
      'Mercado Libre',
      'Google Shopping',
      'Cancelar',
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'Falabella' }));
    expect(openURL).toHaveBeenCalledWith('https://www.falabella.com.co/falabella-co/search?Ntt=blazer%20camel%20mujer');

    await fireEvent.press(screen.getByRole('button', { name: /^Buscar en tiendas/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Mercado Libre' }));
    expect(openURL).toHaveBeenLastCalledWith('https://listado.mercadolibre.com.co/blazer-camel-mujer');
  });

  test('Cancel closes the sheet without opening anything', async () => {
    mockedFetch.mockReturnValue(ok({ kind: 'ok', ideas: [BLAZER] }));
    await renderIn('en');

    await fireEvent.press(await screen.findByRole('button', { name: /^Search in stores/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('store-sheet')).not.toBeOnTheScreen();
    expect(openURL).not.toHaveBeenCalled();
  });

  test("a browser that won't open says so instead of failing silently", async () => {
    const alert = jest.spyOn(Alert, 'alert');
    openURL.mockImplementation(() => Promise.reject(new Error('no browser')));
    mockedFetch.mockReturnValue(ok({ kind: 'ok', ideas: [BLAZER] }));
    await renderIn('en');

    await fireEvent.press(await screen.findByRole('button', { name: /^Search in stores/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Google Shopping' }));

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith("Couldn't open the browser. Try again.");
    });
    alert.mockRestore();
  });

  test('an unknown template key shows no line instead of the raw key', async () => {
    mockedFetch.mockReturnValue(ok({ kind: 'ok', ideas: [{ ...SNEAKERS, lineKey: 'forYou.line.later' }] }));
    await render(<ForYouScreen />);

    expect(await screen.findByText('Sneakers · White')).toBeOnTheScreen();
    expect(screen.queryByText('forYou.line.later')).toBeNull();
  });

  test('no ideas shows the empty message', async () => {
    mockedFetch.mockReturnValue(ok({ kind: 'ok', ideas: [] }));
    await render(<ForYouScreen />);

    expect(await screen.findByText('No ideas right now: your closet already covers the basics.')).toBeOnTheScreen();
  });

  test('a good answer is kept in kv for the user and language', async () => {
    mockedFetch.mockReturnValue(ok(IDEAS));
    await render(<ForYouScreen />);
    await screen.findByText('Blazer · Camel');

    expect(JSON.parse(kvGet(storedForYouKey('user-1')) ?? 'null')).toEqual({ en: IDEAS });
  });

  test('the stored ideas show at once while the first fetch runs', async () => {
    storeForYou('user-1', 'en', IDEAS);
    mockedFetch.mockReturnValue(new Promise(() => undefined));
    await render(<ForYouScreen />);

    expect(screen.getByText('Blazer · Camel')).toBeOnTheScreen();
    expect(screen.queryByText('Offline — showing your last ideas')).toBeNull();
  });

  test('shows the loading cards while the first fetch runs', async () => {
    mockedFetch.mockReturnValue(new Promise(() => undefined));
    await render(<ForYouScreen />);

    expect(screen.getByLabelText('Looking for ideas…')).toBeOnTheScreen();
  });
});

describe('the other states', () => {
  test('too_small asks for more pieces and links to the closet', async () => {
    mockedFetch.mockReturnValue(ok({ kind: 'too_small' }));
    await render(<ForYouScreen />);

    expect(await screen.findByText('Add a few more pieces to get ideas')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Go to your closet' }));
    expect(mockedPush).toHaveBeenCalledWith('/closet');
  });

  test('too_small in Spanish', async () => {
    mockedFetch.mockReturnValue(ok({ kind: 'too_small' }));
    await renderIn('es');

    expect(await screen.findByText('Agrega algunas prendas más para recibir ideas')).toBeOnTheScreen();
  });

  test('over quota with nothing stored shows the quota message and no retry', async () => {
    mockedFetch.mockReturnValue(failed('over_quota'));
    await render(<ForYouScreen />);

    expect(await screen.findByText("You've used today's ideas. Try again tomorrow.")).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  test('over quota shows the quota note over the stored ideas', async () => {
    storeForYou('user-1', 'en', IDEAS);
    mockedFetch.mockReturnValue(failed('over_quota'));
    await render(<ForYouScreen />);

    expect(await screen.findByText("You've used today's new ideas. Showing your last ones until tomorrow.")).toBeOnTheScreen();
    expect(screen.getByText('Blazer · Camel')).toBeOnTheScreen();
  });

  test('offline shows the stored ideas with the offline note', async () => {
    storeForYou('user-1', 'en', IDEAS);
    mockedFetch.mockReturnValue(failed('network'));
    await render(<ForYouScreen />);

    expect(await screen.findByText('Offline — showing your last ideas')).toBeOnTheScreen();
    expect(screen.getByText('Blazer · Camel')).toBeOnTheScreen();
    expect(screen.getByText('Sneakers · White')).toBeOnTheScreen();
  });

  test("ideas stored in another language aren't shown offline", async () => {
    storeForYou('user-1', 'es', IDEAS);
    mockedFetch.mockReturnValue(failed('network'));
    await render(<ForYouScreen />);

    expect(await screen.findByText("Couldn't reach the AI. Check your internet and try again.")).toBeOnTheScreen();
    expect(screen.queryByText('Blazer · Camel')).toBeNull();
  });

  test('offline with nothing stored shows the error, and Try again fetches again', async () => {
    mockedFetch.mockReturnValueOnce(failed('network')).mockReturnValueOnce(ok(IDEAS));
    await render(<ForYouScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Blazer · Camel')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  test('a failed refetch keeps the ideas already shown, with a note', async () => {
    mockedFetch.mockReturnValueOnce(ok(IDEAS)).mockReturnValueOnce(failed('unknown'));
    await render(<ForYouScreen />);
    await screen.findByText('Blazer · Camel');

    mockFocus.focused = false;
    await screen.rerender(<ForYouScreen />);
    mockFocus.focused = true;
    await screen.rerender(<ForYouScreen />);

    expect(await screen.findByText("Couldn't refresh your ideas. Showing your last ones.")).toBeOnTheScreen();
    expect(screen.getByText('Blazer · Camel')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});

test('one request at a time: regaining focus during a fetch waits for it', async () => {
  let resolve: () => void = () => undefined;
  mockedFetch
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = () => {
          done({ ok: true, result: IDEAS });
        };
      }),
    )
    .mockReturnValue(ok(IDEAS));
  await render(<ForYouScreen />);

  mockFocus.focused = false;
  await screen.rerender(<ForYouScreen />);
  mockFocus.focused = true;
  await screen.rerender(<ForYouScreen />);
  expect(mockedFetch).toHaveBeenCalledTimes(1);

  resolve();
  expect(await screen.findByText('Blazer · Camel')).toBeOnTheScreen();
  expect(mockedFetch).toHaveBeenCalledTimes(2);
});

describe("listening to For you's ideas", () => {
  beforeEach(() => {
    jest.mocked(Speech.speak).mockClear();
    jest.mocked(Speech.stop).mockClear();
  });

  test("each idea's Listen reads its name and line; another idea's Listen takes over", async () => {
    mockedFetch.mockReturnValue(ok(IDEAS));
    await render(<ForYouScreen />);

    const listen = await screen.findAllByRole('button', { name: 'Listen' });
    expect(listen).toHaveLength(2);
    await fireEvent.press(listen[0] as never);
    expect(Speech.speak).toHaveBeenLastCalledWith(
      'Blazer, Camel. A camel blazer dresses up every pair of jeans you own.',
      expect.objectContaining({ language: 'en-US' }),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Listen' }));
    expect(Speech.stop).toHaveBeenCalled();
    expect(Speech.speak).toHaveBeenLastCalledWith(
      "Sneakers, White. Finishes outfits you can't complete today.",
      expect.anything(),
    );
    expect(screen.getAllByRole('button', { name: 'Listen' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(1);
  });

  test('leaving the tab stops it', async () => {
    mockedFetch.mockReturnValue(ok(IDEAS));
    const view = await render(<ForYouScreen />);
    const [first] = await screen.findAllByRole('button', { name: 'Listen' });
    await fireEvent.press(first as never);

    mockFocus.focused = false;
    await view.rerender(<ForYouScreen />);

    expect(Speech.stop).toHaveBeenCalled();
  });
});
