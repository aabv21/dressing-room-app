// Mockup 02 screen 3: the review queue. Rendered directly with the closet, repository and profile
// seams mocked; the queue order and the asked fields themselves are covered by closetSelectors.test.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AccessibilityInfo } from 'react-native';

import ReviewScreen from '../app/review';
import { usePendingPolling } from '../closet/ClosetProvider';
import { confirmReview, type Garment } from '../closet/garmentRepository';
import { garment } from '../test/garmentFixture';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useIsFocused: jest.fn(() => true),
}));

const mockCloset: { garments: Garment[] } = { garments: [] };
const mockReplaceLocal = jest.fn();
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockCloset.garments,
    thumbUrls: new Map(),
    status: 'ready',
    refresh: () => Promise.resolve(),
    replaceLocal: mockReplaceLocal,
    removeLocal: () => undefined,
  }),
  usePendingPolling: jest.fn(),
}));

jest.mock('../closet/garmentRepository', () => ({
  confirmReview: jest.fn(),
  garmentPhotoPath: (userId: string, id: string, variant: string) => `${userId}/${id}/${variant}.webp`,
  signedPhotoUrls: jest.fn((paths: string[]) => Promise.resolve(new Map(paths.map((path) => [path, `https://signed/${path}`])))),
}));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'user-1' }),
}));

jest.mock('../profile/profileRepository', () => ({
  getProfile: jest.fn(() => Promise.resolve({ clothing_type: 'everything' })),
}));

const mockedConfirmReview = jest.mocked(confirmReview);

/** What the AI's `low-confidence` fixture leaves: everything filled, formality doubted. */
function extracted(id: string, minute: number, overrides: Partial<Garment> = {}): Garment {
  return garment({
    id,
    created_at: `2026-11-08T12:0${String(minute)}:00.000Z`,
    extraction_status: 'done',
    category: 'jeans',
    colors: ['navy', 'light_blue'],
    pattern: 'solid',
    material: 'denim',
    formality: 2,
    seasons: ['spring', 'autumn', 'winter'],
    warmth: 2,
    fit: 'regular',
    occasions: ['university', 'going_out', 'home'],
    uncertain_fields: ['formality'],
    ...overrides,
  });
}

function three(): Garment[] {
  return [extracted('g-1', 1), extracted('g-2', 2, { category: 't_shirt' }), extracted('g-3', 3, { category: 'dress' })];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCloset.garments = [];
});

async function renderReview(): Promise<void> {
  await render(<ReviewScreen />);
  // Let the photo signing and the profile read settle.
  await waitFor(() => {
    expect(screen.getByLabelText('Garment photo')).toBeOnTheScreen();
  });
}

test('3 queued shows "1 of 3", with the title, and polls while focused', async () => {
  mockCloset.garments = three();
  await renderReview();

  expect(screen.getByRole('header', { name: 'REVIEW' })).toBeOnTheScreen();
  expect(screen.getByText('1 of 3')).toBeOnTheScreen();
  expect(usePendingPolling).toHaveBeenCalledWith(true);
});

test('only the doubted field is asked; the rest show confirmed', async () => {
  mockCloset.garments = three();
  await renderReview();

  expect(screen.getByText("The AI isn't sure: is it casual or formal?")).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Casual' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Category · Jeans' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Color · Navy, Light blue' })).toBeOnTheScreen();
  expect(screen.queryByText(/isn't sure: what is it/)).not.toBeOnTheScreen();
});

test('the full photo is signed and cached by photo version', async () => {
  mockCloset.garments = [extracted('g-1', 1, { photo_version: 4 })];
  await renderReview();

  const photo = screen.getByLabelText('Garment photo');
  // expo-image's host view receives the source normalized to a list.
  expect(photo.props.source).toEqual([
    expect.objectContaining({ uri: 'https://signed/user-1/g-1/full.webp', cacheKey: 'g-1:full:4' }),
  ]);
});

test('Skip moves to "2 of 3", and Skip on the last wraps to "1 of 3"', async () => {
  mockCloset.garments = three();
  await renderReview();

  await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
  expect(screen.getByText('2 of 3')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Category · T-shirt' })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
  expect(screen.getByText('3 of 3')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
  expect(screen.getByText('1 of 3')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Category · Jeans' })).toBeOnTheScreen();
});

test('Confirm saves the edited values, applies them locally and moves on', async () => {
  mockCloset.garments = three();
  mockedConfirmReview.mockResolvedValue({ ok: true });
  await renderReview();

  await fireEvent.press(screen.getByRole('radio', { name: 'Formal' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));

  expect(mockedConfirmReview).toHaveBeenCalledWith('g-1', {
    category: 'jeans',
    colors: ['navy', 'light_blue'],
    pattern: 'solid',
    material: 'denim',
    formality: 4,
    seasons: ['spring', 'autumn', 'winter'],
    warmth: 2,
    fit: 'regular',
    occasions: ['university', 'going_out', 'home'],
  });
  await waitFor(() => {
    expect(screen.getByText('2 of 3')).toBeOnTheScreen();
  });
  expect(mockReplaceLocal).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'g-1', formality: 4, reviewed_at: expect.any(String) as unknown }),
  );
  expect(screen.getByRole('button', { name: 'Category · T-shirt' })).toBeOnTheScreen();
});

test('a confirmed row can be edited in place', async () => {
  mockCloset.garments = three();
  mockedConfirmReview.mockResolvedValue({ ok: true });
  await renderReview();

  await fireEvent.press(screen.getByRole('button', { name: 'Category · Jeans' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Shorts' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));

  expect(mockedConfirmReview).toHaveBeenCalledWith('g-1', expect.objectContaining({ category: 'shorts' }));
});

test('a failed read asks the basics, and Confirm stays disabled until there is a category', async () => {
  mockCloset.garments = [garment({ id: 'g-1', extraction_status: 'failed' })];
  mockedConfirmReview.mockResolvedValue({ ok: true });
  await renderReview();

  expect(screen.getByText("We couldn't read this photo. Fill in the basics.")).toBeOnTheScreen();
  expect(screen.getByText("The AI isn't sure: what is it?")).toBeOnTheScreen();
  const confirm = screen.getByRole('button', { name: 'Confirm' });
  expect(confirm).toBeDisabled();

  await fireEvent.press(screen.getByRole('radio', { name: 'Hoodie' }));

  expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
});

type HostNode = { type: unknown; parent: HostNode | null };

function insideScrollView(node: HostNode): boolean {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (current.type === 'RCTScrollView') {
      return true;
    }
  }
  return false;
}

test('a network error shows the message by the buttons, announces it and keeps the values', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  mockCloset.garments = three();
  mockedConfirmReview.mockResolvedValue({ ok: false, error: 'network' });
  await renderReview();

  await fireEvent.press(screen.getByRole('radio', { name: 'Both' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));

  const message = await screen.findByText("Couldn't save. Check your internet and try again.");
  expect(message).toBeOnTheScreen();
  // In the anchored CTA zone (always visible), not at the end of the scrolling form.
  expect(insideScrollView(message as unknown as HostNode)).toBe(false);
  expect(insideScrollView(screen.getByRole('radio', { name: 'Both' }) as unknown as HostNode)).toBe(true);
  expect(announce).toHaveBeenCalledWith("Couldn't save. Check your internet and try again.");
  expect(screen.getByRole('radio', { name: 'Both' })).toBeChecked();
  expect(screen.getByText('1 of 3')).toBeOnTheScreen();
  expect(mockReplaceLocal).not.toHaveBeenCalled();
  announce.mockRestore();
});

test('an older garment joining the queue keeps the card on screen and its draft', async () => {
  mockCloset.garments = three();
  await renderReview();
  await fireEvent.press(screen.getByRole('radio', { name: 'Formal' }));

  // Polling brings in a garment created before the one on screen (e.g. its extraction just finished).
  mockCloset.garments = [extracted('g-0', 0, { category: 'skirt' }), ...three()];
  await screen.rerender(<ReviewScreen />);

  expect(screen.getByRole('button', { name: 'Category · Jeans' })).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Formal' })).toBeChecked();
  expect(screen.getByText('2 of 4')).toBeOnTheScreen();
});

test('the garment on screen removed elsewhere moves to the next one by position', async () => {
  mockCloset.garments = three();
  await renderReview();
  await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
  expect(screen.getByRole('button', { name: 'Category · T-shirt' })).toBeOnTheScreen();

  // g-2 (on screen) is deleted elsewhere while an older garment joins: the next is g-3, not g-1.
  mockCloset.garments = [extracted('g-0', 0, { category: 'skirt' }), extracted('g-1', 1), extracted('g-3', 3, { category: 'dress' })];
  await screen.rerender(<ReviewScreen />);
  expect(screen.getByRole('button', { name: 'Category · Dress' })).toBeOnTheScreen();
  expect(screen.getByText('3 of 3')).toBeOnTheScreen();

  // The last one gone too: wraps to the first, never an out-of-range index.
  mockCloset.garments = [extracted('g-0', 0, { category: 'skirt' }), extracted('g-1', 1)];
  await screen.rerender(<ReviewScreen />);
  expect(screen.getByRole('button', { name: 'Category · Skirt' })).toBeOnTheScreen();
  expect(screen.getByText('1 of 2')).toBeOnTheScreen();
});

test('a doubted category offers every category, not only its slot', async () => {
  mockCloset.garments = [extracted('g-1', 1, { uncertain_fields: ['category'] })];
  await renderReview();

  expect(screen.getByText("The AI isn't sure: what is it?")).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Jeans' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'T-shirt' })).toBeOnTheScreen();
});

test('over quota shows its notice', async () => {
  mockCloset.garments = [garment({ id: 'g-1', extraction_status: 'over_quota' })];
  await renderReview();

  expect(screen.getByText("Today's AI limit is reached. Fill in the basics.")).toBeOnTheScreen();
});

test("an empty queue shows the caught-up state, whose button goes back", async () => {
  mockCloset.garments = [extracted('g-1', 1, { reviewed_at: '2026-11-08T12:30:00.000Z' })];
  await render(<ReviewScreen />);

  expect(screen.getByText("You're all caught up")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to closet' }));
  expect(router.back).toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
});

test('a deep-linked caught-up screen with no history lands on the closet', async () => {
  jest.mocked(router.canGoBack).mockReturnValueOnce(false);
  mockCloset.garments = [extracted('g-1', 1, { reviewed_at: '2026-11-08T12:30:00.000Z' })];
  await render(<ReviewScreen />);

  await fireEvent.press(screen.getByRole('button', { name: 'Back to closet' }));
  expect(router.replace).toHaveBeenCalledWith('/closet');
  expect(router.back).not.toHaveBeenCalled();
});
