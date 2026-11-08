// The "How does it look?" result screen (mockup 01 screen 3): the score ring, label, AI confidence,
// reasons, a one-tap swap, and Save / I'll wear it. Rendered directly with the closet, the AI
// client and the outfit repository mocked.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';

import RateScreen from '../app/rate';
import type { Garment } from '../closet/garmentRepository';
import { rateOutfit, type AiOutcome } from '../outfits/aiClient';
import { logWear, saveOutfit } from '../outfits/outfitRepository';
import type { RatingResult } from '../outfits/types';
import { garment } from '../test/garmentFixture';

const mockParams: { ids?: string; occasion?: string } = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => mockParams,
}));

const mockCloset: { garments: Garment[] } = { garments: [] };
const mockRefresh = jest.fn(() => Promise.resolve());
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockCloset.garments,
    thumbUrls: new Map([['top-1', 'https://signed/top-1']]),
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
  garment({ id: 'top-1', category: 'blouse', colors: ['black'], extraction_status: 'done', wear_count: 9 }),
  garment({ id: 'skirt-1', category: 'skirt', colors: ['camel'], extraction_status: 'done', wear_count: 1 }),
  garment({ id: 'heels-1', category: 'heels', colors: ['black'], extraction_status: 'done', wear_count: 0 }),
  garment({ id: 'boots-1', category: 'boots', colors: ['brown'], extraction_status: 'done', wear_count: 4 }),
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
  mockParams.ids = 'top-1,skirt-1,heels-1';
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
  mockRefresh.mockClear();
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
    garmentIds: ['top-1', 'skirt-1', 'heels-1'],
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
      ok(result({ score: 62, label: 'fair', weakestSlot: 'shoes', swap: { fromId: 'heels-1', toId: 'boots-1', score: 81 } })),
    )
    .mockReturnValueOnce(ok(result({ score: 81, label: 'good' })));
  await render(<RateScreen />);

  expect(await screen.findByText('Try: swap Heels · Black for Boots · Brown')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Try the swap' }));

  expect(await screen.findByText('81%')).toBeOnTheScreen();
  expect(mockedRate).toHaveBeenCalledTimes(2);
  expect(mockedRate).toHaveBeenLastCalledWith({
    garmentIds: ['top-1', 'skirt-1', 'boots-1'],
    occasion: 'office',
    date: '2026-11-08',
  });
  expect(screen.queryByText(/Try: swap/)).toBeNull();
});

test('a swap whose target is gone on re-rating shows the not-found message, not a crash', async () => {
  mockedRate
    .mockReturnValueOnce(
      ok(result({ score: 62, label: 'fair', weakestSlot: 'shoes', swap: { fromId: 'heels-1', toId: 'boots-1', score: 81 } })),
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

test('renders the outfit pieces in slot order with their wear counts', async () => {
  mockedRate.mockReturnValue(ok(result()));
  await render(<RateScreen />);

  await screen.findByText('78%');
  const labels = screen.getAllByTestId(/^outfit-piece-/).map((row) => row.props.testID as string);
  expect(labels).toEqual(['outfit-piece-top-1', 'outfit-piece-skirt-1', 'outfit-piece-heels-1']);
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
  expect(mockedSaveOutfit).toHaveBeenCalledWith(['top-1', 'skirt-1', 'heels-1']);
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
    garmentIds: ['top-1', 'skirt-1', 'heels-1'],
    wornOn: '2026-11-08',
    occasion: 'office',
    score: 78,
  });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
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
  mockParams.ids = 'top-1';
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
  expect(ring).toHaveAccessibleName('78%');
  expect(ring).toHaveProp('accessibilityValue', { min: 0, max: 100, now: 78 });
});


test('new params on the open screen rate the new outfit from scratch', async () => {
  mockedRate.mockReturnValueOnce(ok(result())).mockReturnValueOnce(ok(result({ score: 90, label: 'great' })));
  await render(<RateScreen />);
  await screen.findByText('78%');

  mockParams.ids = 'top-1,skirt-1,boots-1';
  await screen.rerender(<RateScreen />);

  expect(await screen.findByText('90%')).toBeOnTheScreen();
  expect(mockedRate).toHaveBeenLastCalledWith(expect.objectContaining({ garmentIds: ['top-1', 'skirt-1', 'boots-1'] }));
});
