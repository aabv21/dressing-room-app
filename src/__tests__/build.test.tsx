// The Build tab (mockup 01 screen 2): slot rows, category chips for the active slot, the grid of
// available garments, and "How does it look?" once the outfit is complete. Rendered directly with
// the closet mocked.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import BuildScreen from '../app/(tabs)/build';
import type { Garment } from '../closet/garmentRepository';
import { garment } from '../test/garmentFixture';

const BLOUSE = '00000000-0000-4000-8000-000000000001';
const SKIRT = '00000000-0000-4000-8000-000000000002';
const SNEAKERS = '00000000-0000-4000-8000-000000000003';
const BOOTS = '00000000-0000-4000-8000-000000000004';
const HEELS = '00000000-0000-4000-8000-000000000005';
const DRESS = '00000000-0000-4000-8000-000000000006';
const BLAZER = '00000000-0000-4000-8000-000000000007';
const BAG = '00000000-0000-4000-8000-000000000008';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('@shopify/flash-list', () => require('../test/flashListMock'));

const mockCloset: { garments: Garment[] } = { garments: [] };
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockCloset.garments,
    thumbUrls: new Map<string, string>(),
    status: 'ready',
    refresh: () => Promise.resolve(),
    replaceLocal: jest.fn(),
    removeLocal: jest.fn(),
  }),
}));

const mockedPush = jest.mocked(router.push);

const done = { extraction_status: 'done', reviewed_at: '2026-11-08T12:00:00.000Z' } as const;
const CLOSET: Garment[] = [
  garment({ ...done, id: BLOUSE, category: 'blouse', colors: ['black'], wear_count: 9 }),
  garment({ ...done, id: SKIRT, category: 'skirt', colors: ['camel'], wear_count: 21 }),
  garment({ ...done, id: SNEAKERS, category: 'sneakers', colors: ['white'], wear_count: 30 }),
  garment({ ...done, id: BOOTS, category: 'boots', colors: ['brown'], wear_count: 12 }),
  garment({ ...done, id: HEELS, category: 'heels', colors: ['black'], wear_count: 6, status: 'laundry' }),
  garment({ ...done, id: DRESS, category: 'dress', colors: ['black'], wear_count: 2 }),
  garment({ ...done, id: BLAZER, category: 'blazer', colors: ['navy'], wear_count: 3 }),
  garment({ ...done, id: BAG, category: 'bag', colors: ['brown'], wear_count: 0 }),
];

beforeEach(() => {
  mockCloset.garments = CLOSET;
  mockedPush.mockClear();
});

const row = (name: string | RegExp) => screen.getByRole('button', { name });
const cell = (name: string | RegExp) => screen.getByRole('button', { name });
const cta = () => screen.getByRole('button', { name: 'How does it look?' });

test('shows the title, the slot rows with placeholders, and the Top grid first', async () => {
  await render(<BuildScreen />);

  expect(screen.getByRole('header', { name: 'BUILD AN OUTFIT' })).toBeOnTheScreen();
  expect(row('Top, Pick one')).toBeSelected();
  expect(row('Bottom, Pick one')).not.toBeSelected();
  expect(row('Shoes, Pick one')).toBeOnTheScreen();
  expect(row('Over · Accessories, optional')).toBeOnTheScreen();
  expect(cell('Blouse, 9 wears')).toBeOnTheScreen();
  expect(screen.queryByLabelText(/^Sneakers, /)).not.toBeOnTheScreen();
});

test('tapping the Shoes row then a sneaker cell marks Shoes ✓', async () => {
  await render(<BuildScreen />);

  await fireEvent.press(row('Shoes, Pick one'));
  expect(row('Shoes, Pick one')).toBeSelected();
  await fireEvent.press(cell('Sneakers, 30 wears'));

  expect(screen.getByText('Sneakers · White ✓')).toBeOnTheScreen();
  expect(row('Shoes, Sneakers · White ✓')).toBeOnTheScreen();
  expect(cell('Sneakers, 30 wears')).toBeSelected();
  expect(cell('Boots, 12 wears')).not.toBeSelected();
});

test('re-tapping the chosen cell clears the slot', async () => {
  await render(<BuildScreen />);

  await fireEvent.press(cell('Blouse, 9 wears'));
  expect(row('Top, Blouse · Black ✓')).toBeOnTheScreen();
  await fireEvent.press(cell('Blouse, 9 wears'));

  expect(row('Top, Pick one')).toBeOnTheScreen();
});

test('the CTA is disabled until the outfit is complete, then pushes /rate with the 3 ids', async () => {
  await render(<BuildScreen />);
  expect(cta()).toBeDisabled();

  await fireEvent.press(cell('Blouse, 9 wears'));
  await fireEvent.press(row('Bottom, Pick one'));
  await fireEvent.press(cell('Skirt, 21 wears'));
  expect(cta()).toBeDisabled();

  await fireEvent.press(row('Shoes, Pick one'));
  await fireEvent.press(cell('Sneakers, 30 wears'));
  expect(cta()).toBeEnabled();

  await fireEvent.press(cta());
  expect(mockedPush).toHaveBeenCalledTimes(1);
  expect(mockedPush).toHaveBeenCalledWith({ pathname: '/rate', params: { ids: `${BLOUSE},${SKIRT},${SNEAKERS}` } });
});

test('garments in the laundry do not appear', async () => {
  await render(<BuildScreen />);

  await fireEvent.press(row('Shoes, Pick one'));

  expect(cell('Sneakers, 30 wears')).toBeOnTheScreen();
  expect(cell('Boots, 12 wears')).toBeOnTheScreen();
  expect(screen.queryByLabelText(/^Heels/)).not.toBeOnTheScreen();
  expect(screen.queryByRole('radio', { name: 'Heels' })).not.toBeOnTheScreen();
});

test('category chips filter the grid, and All shows every piece again', async () => {
  await render(<BuildScreen />);
  await fireEvent.press(row('Shoes, Pick one'));
  expect(screen.getByRole('radio', { name: 'All' })).toBeSelected();

  await fireEvent.press(screen.getByRole('radio', { name: 'Boots' }));
  expect(cell('Boots, 12 wears')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Sneakers, 30 wears')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('radio', { name: 'All' }));
  expect(cell('Sneakers, 30 wears')).toBeOnTheScreen();
  expect(cell('Boots, 12 wears')).toBeOnTheScreen();
});

test('a slot change resets the category filter', async () => {
  await render(<BuildScreen />);
  await fireEvent.press(row('Shoes, Pick one'));
  await fireEvent.press(screen.getByRole('radio', { name: 'Boots' }));

  await fireEvent.press(row('Top, Pick one'));
  await fireEvent.press(row('Shoes, Pick one'));

  expect(screen.getByRole('radio', { name: 'All' })).toBeSelected();
  expect(cell('Sneakers, 30 wears')).toBeOnTheScreen();
});

test('a dress in the Bottom row replaces the top and bottom, and dress + shoes can be rated', async () => {
  await render(<BuildScreen />);
  await fireEvent.press(cell('Blouse, 9 wears'));
  await fireEvent.press(row('Bottom, Pick one'));
  await fireEvent.press(cell('Skirt, 21 wears'));

  await fireEvent.press(cell('Dress, 2 wears'));

  expect(row('One-piece, Dress · Black ✓')).toBeSelected();
  expect(screen.queryByRole('button', { name: /^Top, / })).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /^Bottom, / })).not.toBeOnTheScreen();

  await fireEvent.press(row('Shoes, Pick one'));
  await fireEvent.press(cell('Boots, 12 wears'));
  await fireEvent.press(cta());
  expect(mockedPush).toHaveBeenCalledWith({ pathname: '/rate', params: { ids: `${DRESS},${BOOTS}` } });
});

test('the optional row takes outerwear and one accessory, all sent to /rate', async () => {
  await render(<BuildScreen />);
  await fireEvent.press(row('Over · Accessories, optional'));
  await fireEvent.press(cell('Blazer, 3 wears'));
  await fireEvent.press(cell('Bag, never worn'));

  expect(screen.getByText('Blazer · Navy, Bag · Brown ✓')).toBeOnTheScreen();

  await fireEvent.press(row('Top, Pick one'));
  await fireEvent.press(cell('Blouse, 9 wears'));
  await fireEvent.press(row('Bottom, Pick one'));
  await fireEvent.press(cell('Skirt, 21 wears'));
  await fireEvent.press(row('Shoes, Pick one'));
  await fireEvent.press(cell('Sneakers, 30 wears'));
  await fireEvent.press(cta());

  expect(mockedPush).toHaveBeenCalledWith({
    pathname: '/rate',
    params: { ids: `${BLOUSE},${SKIRT},${BLAZER},${SNEAKERS},${BAG}` },
  });
});

test('a chosen piece sent to the laundry while the tab stays mounted leaves the outfit', async () => {
  const view = await render(<BuildScreen />);
  await fireEvent.press(row('Shoes, Pick one'));
  await fireEvent.press(cell('Sneakers, 30 wears'));
  expect(row('Shoes, Sneakers · White ✓')).toBeOnTheScreen();

  mockCloset.garments = CLOSET.map((item) => (item.id === SNEAKERS ? { ...item, status: 'laundry' } : item));
  await view.rerender(<BuildScreen />);

  expect(row('Shoes, Pick one')).toBeOnTheScreen();
  expect(screen.queryByLabelText(/^Sneakers, /)).not.toBeOnTheScreen();
});

test('a slot with nothing available says so', async () => {
  mockCloset.garments = CLOSET.filter((item) => item.id !== BLOUSE);
  await render(<BuildScreen />);

  expect(screen.getByText('Nothing available for this slot. Add pieces in your closet.')).toBeOnTheScreen();
});
