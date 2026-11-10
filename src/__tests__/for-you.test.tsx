// The For you tab: 3–5 "what you're missing" ideas from `for-you`, each with "Search in stores".
// Rendered directly with auth, focus and the AI client mocked; kv is the in-memory test store.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking } from 'react-native';

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
  mockedFetch.mockReset();
  mockedPush.mockClear();
  kvRemove(storedForYouKey('user-1'));
  openURL = jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve());
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
    expect(mockedFetch).toHaveBeenCalledWith({ language: 'en' });
  });

  test('render in Spanish, and "Buscar en tiendas" opens the encoded Google search with hl=es', async () => {
    const es: ForYouResponse = {
      kind: 'ok',
      ideas: [{ ...BLAZER, line: null, lineKey: 'forYou.line.outerwear', searchQuery: 'blazer camel mujer' }],
    };
    mockedFetch.mockReturnValue(ok(es));
    await renderIn('es');

    expect(await screen.findByText('Combina con 8 de tus prendas (+14 outfits)')).toBeOnTheScreen();
    expect(screen.getByText('PARA TI')).toBeOnTheScreen();
    expect(screen.getByText('Ponla sobre los outfits que ya usas para completarlos.')).toBeOnTheScreen();
    expect(mockedFetch).toHaveBeenCalledWith({ language: 'es' });

    await fireEvent.press(screen.getByRole('button', { name: /^Buscar en tiendas/ }));

    expect(openURL).toHaveBeenCalledWith('https://www.google.com/search?q=blazer%20camel%20mujer&hl=es');
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

    expect(await screen.findByText("You've used today's new ideas. Showing your last ones.")).toBeOnTheScreen();
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
