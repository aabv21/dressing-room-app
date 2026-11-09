// The "How does it look?" result screen (mockup 01 screen 3): the score ring, label, AI confidence,
// reasons, a one-tap swap, and Save / I'll wear it. Rendered directly with the closet, the AI
// client and the outfit repository mocked.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';

import RateScreen from '../app/rate';
import { I18nProvider } from '../i18n/I18nProvider';
import { kvRemove, kvSet } from '../lib/kv';
import type { Garment } from '../closet/garmentRepository';
import { rateOutfit, type AiOutcome } from '../outfits/aiClient';
import { logWear, saveOutfit } from '../outfits/outfitRepository';
import type { RatingResult } from '../outfits/types';
import { garment } from '../test/garmentFixture';

// UUID-shaped, as the screen checks before calling the function.
const TOP = '00000000-0000-4000-8000-000000000001';
const SKIRT = '00000000-0000-4000-8000-000000000002';
const HEELS = '00000000-0000-4000-8000-000000000003';
const BOOTS = '00000000-0000-4000-8000-000000000004';

const mockParams: { ids?: string; occasion?: string } = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'user-1' }),
}));

const mockCloset: { garments: Garment[] } = { garments: [] };
const mockRefresh = jest.fn(() => Promise.resolve());
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockCloset.garments,
    thumbUrls: new Map([[TOP, `https://signed/${TOP}`]]),
    status: 'ready',
    refresh: mockRefresh,
    replaceLocal: jest.fn(),
    removeLocal: jest.fn(),
  }),
}));

jest.mock('../outfits/aiClient', () => ({
  rateOutfit: jest.fn(),
  localDate: () => '2026-11-08',
}));

jest.mock('../outfits/outfitRepository', () => ({
  logWear: jest.fn(),
  saveOutfit: jest.fn(),
}));

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

const mockedRate = jest.mocked(rateOutfit);
const mockedLogWear = jest.mocked(logWear);
const mockedSaveOutfit = jest.mocked(saveOutfit);
const mockedUuid = jest.mocked(randomUUID);
const mockedCanGoBack = jest.mocked(router.canGoBack);

const CLOSET: Garment[] = [
  garment({ id: TOP, category: 'blouse', colors: ['black'], extraction_status: 'done', wear_count: 9 }),
  garment({ id: SKIRT, category: 'skirt', colors: ['camel'], extraction_status: 'done', wear_count: 1 }),
  garment({ id: HEELS, category: 'heels', colors: ['black'], extraction_status: 'done', wear_count: 0 }),
  garment({ id: BOOTS, category: 'boots', colors: ['brown'], extraction_status: 'done', wear_count: 4 }),
];

function result(overrides: Partial<RatingResult> = {}): RatingResult {
  return {
    score: 78,
    label: 'good',
    confidence: 85,
    estimated: false,
    reasons: [],
    weakestSlot: null,
    swap: null,
    noBetterSwap: false,
    ...overrides,
  };
}

function ok(value: RatingResult): Promise<AiOutcome<RatingResult>> {
  return Promise.resolve({ ok: true, result: value });
}

beforeEach(() => {
  mockParams.ids = `${TOP},${SKIRT},${HEELS}`;
  mockParams.occasion = 'office';
  mockCloset.garments = CLOSET;
  mockedRate.mockReset();
  mockedLogWear.mockReset();
  mockedSaveOutfit.mockReset();
  mockedUuid.mockReset();
  mockedUuid.mockReturnValueOnce('wear-1').mockReturnValueOnce('wear-2');
  mockedCanGoBack.mockReturnValue(true);
  jest.mocked(router.back).mockClear();
  jest.mocked(router.replace).mockClear();
  jest.mocked(router.push).mockClear();
  mockRefresh.mockClear();
  kvRemove('outfit.worn.user-1');
});

test('rates the outfit on mount and shows the score, label and AI confidence', async () => {
  mockedRate.mockReturnValue(ok(result()));
  await render(<RateScreen />);

  expect(await screen.findByText('78%')).toBeOnTheScreen();
  expect(screen.getByText('Looks good')).toBeOnTheScreen();
  expect(screen.getByText('AI confidence: 85%')).toBeOnTheScreen();
  expect(screen.getByText('HOW DOES IT LOOK?')).toBeOnTheScreen();
  expect(mockedRate).toHaveBeenCalledTimes(1);
  expect(mockedRate).toHaveBeenCalledWith({
    garmentIds: [TOP, SKIRT, HEELS],
    occasion: 'office',
    date: '2026-11-08',
  });
});

test('shows the loading ring and text while the rating is pending', async () => {
  mockedRate.mockReturnValue(new Promise(() => undefined));
  await render(<RateScreen />);

  expect(screen.getByText('Looking at your outfit…')).toBeOnTheScreen();
  expect(screen.getByTestId('score-ring-placeholder')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: "I'll wear it" })).toBeNull();
});

test('an unknown occasion param is sent as no occasion', async () => {
  mockParams.occasion = 'beach';
  mockedRate.mockReturnValue(ok(result()));
  await render(<RateScreen />);

  await screen.findByText('78%');
  expect(mockedRate).toHaveBeenCalledWith(expect.objectContaining({ occasion: null }));
});

test('an estimated rating shows the estimated confidence', async () => {
  mockedRate.mockReturnValue(ok(result({ estimated: true, confidence: null })));
  await render(<RateScreen />);

  expect(await screen.findByText('AI confidence: estimated')).toBeOnTheScreen();
  expect(screen.queryByText(/AI confidence: \d/)).toBeNull();
});

test('renders good and warn reasons with their icons, localizing the colors', async () => {
  mockedRate.mockReturnValue(
    ok(
      result({
        reasons: [
          { key: 'rating.reason.color_harmony.good', tone: 'good', params: { colors: 'black,camel' } },
          { key: 'rating.reason.body_flattery.good', tone: 'good' },
          { key: 'rating.reason.formality_coherence.warn', tone: 'warn' },
        ],
      }),
    ),
  );
  await render(<RateScreen />);

  expect(await screen.findByText('Black and camel go well together')).toBeOnTheScreen();
  expect(screen.getByText('It flatters your body type (from your profile)')).toBeOnTheScreen();
  expect(screen.getByText('The pieces mix very different levels of formality')).toBeOnTheScreen();
  expect(screen.getAllByTestId('reason-icon-good')).toHaveLength(2);
  expect(screen.getAllByTestId('reason-icon-warn')).toHaveLength(1);
});

test('empty colors and an unknown reason key never render a broken row', async () => {
  mockedRate.mockReturnValue(
    ok(
      result({
        reasons: [
          { key: 'rating.reason.color_harmony.good', tone: 'good', params: { colors: '' } },
          { key: 'rating.reason.not_a_dimension.good', tone: 'good' },
        ],
      }),
    ),
  );
  await render(<RateScreen />);

  expect(await screen.findByText('The colors go well together')).toBeOnTheScreen();
  expect(screen.getAllByTestId('reason-icon-good')).toHaveLength(1);
  expect(screen.queryByText(/rating\.reason/)).toBeNull();
});

test('three colors are joined for the locale', async () => {
  mockedRate.mockReturnValue(
    ok(
      result({
        reasons: [{ key: 'rating.reason.color_harmony.good', tone: 'good', params: { colors: 'navy,white,light_blue' } }],
      }),
    ),
  );
  await render(<RateScreen />);

  expect(await screen.findByText('Navy, white and light blue go well together')).toBeOnTheScreen();
});

test('"Try the swap" re-rates the outfit with the swapped id on the same screen', async () => {
  mockedRate
    .mockReturnValueOnce(
      ok(result({ score: 62, label: 'fair', weakestSlot: 'shoes', swap: { fromId: HEELS, toId: BOOTS, score: 81 } })),
    )
    .mockReturnValueOnce(ok(result({ score: 81, label: 'good' })));
  await render(<RateScreen />);

  expect(await screen.findByText('Try: swap Heels · Black for Boots · Brown')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Try the swap' }));

  expect(await screen.findByText('81%')).toBeOnTheScreen();
  expect(mockedRate).toHaveBeenCalledTimes(2);
  expect(mockedRate).toHaveBeenLastCalledWith({
    garmentIds: [TOP, SKIRT, BOOTS],
    occasion: 'office',
    date: '2026-11-08',
  });
  expect(screen.queryByText(/Try: swap/)).toBeNull();
});

test('a swap whose target is gone on re-rating shows the not-found message, not a crash', async () => {
  mockedRate
    .mockReturnValueOnce(
      ok(result({ score: 62, label: 'fair', weakestSlot: 'shoes', swap: { fromId: HEELS, toId: BOOTS, score: 81 } })),
    )
    .mockReturnValueOnce(Promise.resolve({ ok: false, error: 'not_found' }));
  await render(<RateScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Try the swap' }));

  expect(await screen.findByText('Some of these pieces are no longer in your closet.')).toBeOnTheScreen();
});

test('noBetterSwap shows its line', async () => {
  mockedRate.mockReturnValue(ok(result({ score: 64, label: 'fair', weakestSlot: 'shoes', noBetterSwap: true })));
  await render(<RateScreen />);

  expect(await screen.findByText('It already works, no better swap')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Try the swap' })).toBeNull();
});

test('a low fallback result without a swap search shows neither the swap nor the no-better line', async () => {
  mockedRate.mockReturnValue(
    ok(result({ score: 55, label: 'fair', estimated: true, confidence: null, weakestSlot: 'shoes', swap: null, noBetterSwap: false })),
  );
  await render(<RateScreen />);

  expect(await screen.findByText('55%')).toBeOnTheScreen();
  expect(screen.queryByText('It already works, no better swap')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Try the swap' })).toBeNull();
});

describe('the "Missing something?" link', () => {
  const LINK = 'Missing something? → For you';

  test.each([
    ['no better swap', result({ score: 64, label: 'fair', weakestSlot: 'shoes', noBetterSwap: true })],
    [
      'a fallback result with no swap search',
      result({ score: 55, label: 'fair', estimated: true, confidence: null, weakestSlot: 'shoes', swap: null }),
    ],
  ])('shows under 70 with %s, and opens For you', async (_name, value) => {
    mockedRate.mockReturnValue(ok(value));
    await render(<RateScreen />);

    await fireEvent.press(await screen.findByRole('link', { name: LINK }));

    expect(router.push).toHaveBeenCalledWith('/for-you');
  });

  test.each([
    ['a swap is offered', result({ score: 64, label: 'fair', weakestSlot: 'shoes', swap: { fromId: HEELS, toId: BOOTS, score: 81 } })],
    ['the score is 70', result({ score: 70, label: 'good', noBetterSwap: true })],
    ['the score is high', result()],
  ])('is hidden when %s', async (_name, value) => {
    mockedRate.mockReturnValue(ok(value));
    await render(<RateScreen />);

    await screen.findByText(`${String(value.score)}%`);
    expect(screen.queryByRole('link', { name: LINK })).toBeNull();
  });

  test('reads "¿Te falta algo? → Para ti" in Spanish', async () => {
    mockedRate.mockReturnValue(ok(result({ score: 64, label: 'fair', noBetterSwap: true })));
    kvSet('locale-preference', 'es');
    try {
      await render(
        <I18nProvider>
          <RateScreen />
        </I18nProvider>,
      );
      expect(await screen.findByRole('link', { name: '¿Te falta algo? → Para ti' })).toBeOnTheScreen();
    } finally {
      kvSet('locale-preference', 'system');
    }
  });
});

test('renders the outfit pieces in slot order with their wear counts', async () => {
  mockedRate.mockReturnValue(ok(result()));
  await render(<RateScreen />);

  await screen.findByText('78%');
  const labels = screen.getAllByTestId(/^outfit-piece-/).map((row) => row.props.testID as string);
  expect(labels).toEqual([`outfit-piece-${TOP}`, `outfit-piece-${SKIRT}`, `outfit-piece-${HEELS}`]);
  expect(screen.getByText('Blouse · Black')).toBeOnTheScreen();
  expect(screen.getByText('9 wears')).toBeOnTheScreen();
  expect(screen.getByText('never worn')).toBeOnTheScreen();
});

test('Save calls saveOutfit with the ids once, then shows Saved ✓', async () => {
  mockedRate.mockReturnValue(ok(result()));
  let resolveSave: (value: { ok: true }) => void = () => undefined;
  mockedSaveOutfit.mockReturnValue(
    new Promise((resolve) => {
      resolveSave = resolve;
    }),
  );
  await render(<RateScreen />);

  const save = await screen.findByRole('button', { name: 'Save' });
  await fireEvent.press(save);
  await fireEvent.press(save);
  expect(mockedSaveOutfit).toHaveBeenCalledTimes(1);
  expect(mockedSaveOutfit).toHaveBeenCalledWith([TOP, SKIRT, HEELS]);
  expect(screen.getByRole('button', { name: "I'll wear it" })).toBeDisabled();

  resolveSave({ ok: true });
  expect(await screen.findByRole('button', { name: 'Saved ✓' })).toBeDisabled();
  expect(screen.getByRole('button', { name: "I'll wear it" })).toBeEnabled();
});

test('a failed save shows the error in the CTA notice and can be tried again', async () => {
  mockedRate.mockReturnValue(ok(result()));
  mockedSaveOutfit.mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: true });
  await render(<RateScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Save' }));
  expect(await screen.findByText("Couldn't connect. Check your internet and try again.")).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('button', { name: 'Saved ✓' })).toBeOnTheScreen();
  expect(screen.queryByText("Couldn't connect. Check your internet and try again.")).toBeNull();
});

test('"I\'ll wear it" logs the wear with the score, then shows Logged ✓ and refreshes the closet', async () => {
  mockedRate.mockReturnValue(ok(result()));
  mockedLogWear.mockResolvedValue({ ok: true });
  await render(<RateScreen />);

  const wear = await screen.findByRole('button', { name: "I'll wear it" });
  await fireEvent.press(wear);
  await fireEvent.press(wear);

  expect(await screen.findByRole('button', { name: 'Logged ✓' })).toBeDisabled();
  expect(mockedLogWear).toHaveBeenCalledTimes(1);
  expect(mockedLogWear).toHaveBeenCalledWith({
    wearId: 'wear-1',
    garmentIds: [TOP, SKIRT, HEELS],
    wornOn: '2026-11-08',
    occasion: 'office',
    score: 78,
  });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test('rating the same outfit again (Build: rate, wear, back, rate) opens as Logged ✓, in any id order', async () => {
  mockedRate.mockReturnValue(ok(result()));
  mockedLogWear.mockResolvedValue({ ok: true });
  const first = await render(<RateScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
  await screen.findByRole('button', { name: 'Logged ✓' });
  await first.unmount();

  mockParams.ids = `${HEELS},${TOP},${SKIRT}`;
  await render(<RateScreen />);
  await screen.findByText('78%');

  expect(screen.getByRole('button', { name: 'Logged ✓' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: "I'll wear it" })).toBeNull();
  expect(mockedLogWear).toHaveBeenCalledTimes(1);
});

test('retrying a failed wear reuses the same wear id', async () => {
  mockedRate.mockReturnValue(ok(result()));
  mockedLogWear.mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: true });
  await render(<RateScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
  expect(await screen.findByText("Couldn't connect. Check your internet and try again.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: "I'll wear it" }));

  expect(await screen.findByRole('button', { name: 'Logged ✓' })).toBeOnTheScreen();
  expect(mockedLogWear.mock.calls.map(([input]) => input.wearId)).toEqual(['wear-1', 'wear-1']);
});

test('a 429 shows the quota message', async () => {
  mockedRate.mockResolvedValue({ ok: false, error: 'over_quota' });
  await render(<RateScreen />);

  expect(await screen.findByText("You've used today's AI ratings. Try again tomorrow.")).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

test.each(['network', 'unavailable'] as const)('a %s error shows a retry that rates again', async (error) => {
  mockedRate.mockResolvedValueOnce({ ok: false, error }).mockReturnValueOnce(ok(result()));
  await render(<RateScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('78%')).toBeOnTheScreen();
  expect(mockedRate).toHaveBeenCalledTimes(2);
});

test.each([
  ['not_found', 'Some of these pieces are no longer in your closet.'],
  ['incomplete', 'This outfit is missing a piece: it needs a top and a bottom (or a one-piece) and shoes.'],
] as const)('%s shows its message and a back button that falls back to Build', async (error, message) => {
  mockedRate.mockResolvedValue({ ok: false, error });
  mockedCanGoBack.mockReturnValue(false);
  await render(<RateScreen />);

  expect(await screen.findByText(message)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Go back' }));
  expect(router.replace).toHaveBeenCalledWith('/build');
  expect(router.back).not.toHaveBeenCalled();
});

test('the header back button goes back when there is history', async () => {
  mockedRate.mockReturnValue(ok(result()));
  await render(<RateScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('fewer than two ids is incomplete without calling the AI', async () => {
  mockParams.ids = TOP;
  await render(<RateScreen />);

  expect(
    await screen.findByText('This outfit is missing a piece: it needs a top and a bottom (or a one-piece) and shoes.'),
  ).toBeOnTheScreen();
  expect(mockedRate).not.toHaveBeenCalled();
});

test('ScoreRing exposes its score as a progressbar', async () => {
  mockedRate.mockReturnValue(ok(result()));
  await render(<RateScreen />);

  const ring = await screen.findByRole('progressbar');
  expect(ring).toHaveAccessibleName('Score');
  expect(ring).toHaveProp('accessibilityValue', { min: 0, max: 100, now: 78 });
});


test('new params on the open screen rate the new outfit from scratch', async () => {
  mockedRate.mockReturnValueOnce(ok(result())).mockReturnValueOnce(ok(result({ score: 90, label: 'great' })));
  await render(<RateScreen />);
  await screen.findByText('78%');

  mockParams.ids = `${TOP},${SKIRT},${BOOTS}`;
  await screen.rerender(<RateScreen />);

  expect(await screen.findByText('90%')).toBeOnTheScreen();
  expect(mockedRate).toHaveBeenLastCalledWith(expect.objectContaining({ garmentIds: [TOP, SKIRT, BOOTS] }));
});

test.each([
  ['en', 'The black tones work together'],
  ['es', 'Los tonos de negro combinan'],
] as const)('a single color reads as one tone (%s)', async (locale, text) => {
  mockedRate.mockReturnValue(
    ok(result({ reasons: [{ key: 'rating.reason.color_harmony.good', tone: 'good', params: { colors: 'black' } }] })),
  );
  kvSet('locale-preference', locale);
  try {
    await render(
      <I18nProvider>
        <RateScreen />
      </I18nProvider>,
    );
    expect(await screen.findByText(text)).toBeOnTheScreen();
  } finally {
    kvSet('locale-preference', 'system');
  }
});

test.each([
  ['a malformed id', `${TOP},not-a-uuid,${HEELS}`, 'Some of these pieces are no longer in your closet.'],
  [
    'more pieces than the function rates',
    Array.from({ length: 7 }, (_, index) => `00000000-0000-4000-8000-00000000010${String(index)}`).join(','),
    'This outfit is missing a piece: it needs a top and a bottom (or a one-piece) and shoes.',
  ],
])('%s is refused without calling the AI, with only a way back', async (_case, ids, message) => {
  mockParams.ids = ids;
  await render(<RateScreen />);

  expect(await screen.findByText(message)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Go back' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  expect(mockedRate).not.toHaveBeenCalled();
});

const LOW_WITH_SWAP = result({
  score: 62,
  label: 'fair',
  weakestSlot: 'shoes',
  swap: { fromId: HEELS, toId: BOOTS, score: 81 },
});

test('"Try the swap" is disabled once the outfit is logged', async () => {
  mockedRate.mockReturnValue(ok(LOW_WITH_SWAP));
  mockedLogWear.mockResolvedValue({ ok: true });
  await render(<RateScreen />);

  expect(await screen.findByRole('button', { name: 'Try the swap' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: "I'll wear it" }));

  expect(await screen.findByRole('button', { name: 'Logged ✓' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Try the swap' })).toBeDisabled();
});

test('after a swap, Save sends the swapped ids', async () => {
  mockedRate.mockReturnValueOnce(ok(LOW_WITH_SWAP)).mockReturnValueOnce(ok(result({ score: 81, label: 'good' })));
  mockedSaveOutfit.mockResolvedValue({ ok: true });
  await render(<RateScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Try the swap' }));
  await screen.findByText('81%');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByRole('button', { name: 'Saved ✓' })).toBeOnTheScreen();
  expect(mockedSaveOutfit).toHaveBeenCalledWith([TOP, SKIRT, BOOTS]);
});

test('after a swap, "I\'ll wear it" sends the swapped ids, the new score and a new wear id', async () => {
  mockedRate.mockReturnValueOnce(ok(LOW_WITH_SWAP)).mockReturnValueOnce(ok(result({ score: 81, label: 'good' })));
  mockedLogWear.mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: true });
  await render(<RateScreen />);

  // A failed attempt on the original outfit takes the first wear id.
  await fireEvent.press(await screen.findByRole('button', { name: "I'll wear it" }));
  await screen.findByText("Couldn't connect. Check your internet and try again.");

  await fireEvent.press(screen.getByRole('button', { name: 'Try the swap' }));
  await screen.findByText('81%');
  await fireEvent.press(screen.getByRole('button', { name: "I'll wear it" }));

  expect(await screen.findByRole('button', { name: 'Logged ✓' })).toBeOnTheScreen();
  expect(mockedLogWear).toHaveBeenLastCalledWith({
    wearId: 'wear-2',
    garmentIds: [TOP, SKIRT, BOOTS],
    wornOn: '2026-11-08',
    occasion: 'office',
    score: 81,
  });
  expect(mockedLogWear.mock.calls.map(([input]) => input.wearId)).toEqual(['wear-1', 'wear-2']);
});

test('the ring is named in Spanish too', async () => {
  mockedRate.mockReturnValue(ok(result()));
  kvSet('locale-preference', 'es');
  try {
    await render(
      <I18nProvider>
        <RateScreen />
      </I18nProvider>,
    );
    expect(await screen.findByRole('progressbar')).toHaveAccessibleName('Puntaje');
  } finally {
    kvSet('locale-preference', 'system');
  }
});
