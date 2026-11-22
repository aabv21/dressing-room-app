// "Should I buy it?": take a photo or pick one, then the verdict, the duplicates, the new outfits and
// "Add to my closet". Rendered directly with the picker, the photo preparation and the call mocked.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import BuyCheckScreen from '../app/buy-check';
import { checkPurchase, type BuyCheckResponse } from '../buyCheck/buyCheckClient';
import type { Garment } from '../closet/garmentRepository';
import { deletePhoto, prepareCheckPhoto } from '../closet/upload/preparePhoto';
import { garment } from '../test/garmentFixture';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
const mockLocales = { tags: ['en-US'] };
jest.mock('expo-localization', () => ({
  getLocales: () => mockLocales.tags.map((languageTag) => ({ languageTag, languageCode: languageTag.slice(0, 2) })),
}));
jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock('../lib/supabase', () => ({ supabase: {} }));
jest.mock('../lib/localDate', () => ({ localDate: () => '2026-11-21' }));
jest.mock('../closet/upload/preparePhoto', () => ({ prepareCheckPhoto: jest.fn(), deletePhoto: jest.fn() }));
jest.mock('../buyCheck/buyCheckClient', () => ({ ...jest.requireActual<object>('../buyCheck/buyCheckClient'), checkPurchase: jest.fn() }));
const mockEnqueue = jest.fn<number, [readonly string[]]>();
jest.mock('../closet/UploadQueueProvider', () => ({ useUploadQueue: () => ({ enqueue: mockEnqueue }) }));

const OWNED = '00000000-0000-4000-8000-000000000008';
const SIMILAR = '00000000-0000-4000-8000-000000000009';
const mockCloset: { garments: Garment[] } = { garments: [] };
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({ garments: mockCloset.garments, thumbUrls: new Map<string, string>(), status: 'ready' }),
}));

const ITEM = {
  category: 'jeans',
  colors: ['navy'],
  pattern: 'solid',
  material: 'denim',
  formality: 2,
  seasons: ['autumn'],
  warmth: 2,
  fit: 'regular',
  occasions: ['university'],
} as const;

const result = (overrides: Partial<Extract<BuyCheckResponse, { kind: 'ok' }>> = {}): BuyCheckResponse => ({
  kind: 'ok',
  item: { ...ITEM, colors: [...ITEM.colors], seasons: [...ITEM.seasons], occasions: [...ITEM.occasions] },
  duplicates: [],
  newOutfits: 12,
  verdict: 'buy',
  ...overrides,
});

const PICKED = 'file:///cache/ImagePicker/picked.jpg';
const SHOT = 'file:///cache/ImagePicker/shot.jpg';

const mockedCheck = jest.mocked(checkPurchase);
const mockedPrepare = jest.mocked(prepareCheckPhoto);
const mockedLibrary = jest.mocked(ImagePicker.launchImageLibraryAsync);
const mockedCamera = jest.mocked(ImagePicker.launchCameraAsync);
const mockedPermission = jest.mocked(ImagePicker.requestCameraPermissionsAsync);
const mockedPush = jest.mocked(router.push);
const mockedDelete = jest.mocked(deletePhoto);

const picked = (uri: string): ImagePicker.ImagePickerResult => ({ canceled: false, assets: [{ uri, width: 3000, height: 4000 }] });

beforeEach(() => {
  jest.clearAllMocks();
  mockLocales.tags = ['en-US'];
  mockCloset.garments = [
    garment({ id: OWNED, category: 'jeans', colors: ['navy'] }),
    garment({ id: SIMILAR, category: 'jeans', colors: ['light_blue', 'navy'] }),
  ];
  mockedLibrary.mockResolvedValue(picked(PICKED));
  mockedCamera.mockResolvedValue(picked(SHOT));
  mockedPermission.mockResolvedValue({ granted: true } as ImagePicker.CameraPermissionResponse);
  mockedPrepare.mockResolvedValue('UklGRg==');
  mockedCheck.mockResolvedValue({ ok: true, result: result() });
  mockEnqueue.mockReturnValue(1);
});

async function fromGallery(): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: 'From gallery' }));
}

test('explains the check and that the photo is not stored, with both ways to add a photo', async () => {
  await render(<BuyCheckScreen />);
  expect(screen.getByRole('header', { name: 'Should I buy it?' })).toBeOnTheScreen();
  expect(
    screen.getByText("The app doesn't store the photo, and neither does its server; Anthropic handles it under its own retention rules."),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Take a photo' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'From gallery' })).toBeOnTheScreen();
});

test('a gallery photo is prepared on the device, then sent with the local day and the language', async () => {
  await render(<BuyCheckScreen />);
  await fromGallery();

  expect(mockedLibrary).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: false }));
  expect(mockedPrepare).toHaveBeenCalledWith(PICKED);
  expect(mockedCheck).toHaveBeenCalledWith({ image: 'UklGRg==', date: '2026-11-21', language: 'en' });
  expect(await screen.findByText('This would open 12 new outfits')).toBeOnTheScreen();
  expect(screen.getByText('Looks like: Jeans · Navy')).toBeOnTheScreen();
  expect(screen.getByText('12 new outfits with your closet')).toBeOnTheScreen();
});

test('a camera shot asks for the camera first, then checks the shot', async () => {
  await render(<BuyCheckScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Take a photo' }));

  expect(mockedPermission).toHaveBeenCalled();
  expect(mockedCamera).toHaveBeenCalled();
  await waitFor(() => {
    expect(mockedPrepare).toHaveBeenCalledWith(SHOT);
  });
});

test('without camera access it says so and never opens the camera', async () => {
  mockedPermission.mockResolvedValue({ granted: false } as ImagePicker.CameraPermissionResponse);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<BuyCheckScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Take a photo' }));

  expect(alert).toHaveBeenCalledWith('Allow camera access in Settings to take a photo, or pick one from your gallery.');
  expect(mockedCamera).not.toHaveBeenCalled();
  expect(mockedCheck).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('a canceled picker leaves the screen as it was', async () => {
  mockedLibrary.mockResolvedValue({ canceled: true, assets: null });
  await render(<BuyCheckScreen />);
  await fromGallery();

  expect(mockedPrepare).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'From gallery' })).toBeOnTheScreen();
});

test('a duplicate: the friendly line, its thumbnails open the garment, and the count', async () => {
  mockedCheck.mockResolvedValue({ ok: true, result: result({ duplicates: [{ id: OWNED }, { id: SIMILAR }], newOutfits: 1, verdict: 'skip' }) });
  await render(<BuyCheckScreen />);
  await fromGallery();

  expect(await screen.findByText('You already have something very similar')).toBeOnTheScreen();
  expect(screen.getByText('1 new outfit with your closet')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Similar in your closet' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('link', { name: 'Open Jeans · Light blue' }));
  expect(mockedPush).toHaveBeenCalledWith(`/garment/${SIMILAR}`);
});

test('a duplicate no longer in the closet is left out', async () => {
  mockedCheck.mockResolvedValue({ ok: true, result: result({ duplicates: [{ id: '00000000-0000-4000-8000-0000000000ff' }], verdict: 'think' }) });
  await render(<BuyCheckScreen />);
  await fromGallery();

  expect(await screen.findByText('Think it over before buying')).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: 'Similar in your closet' })).toBeNull();
});

test('"Add to my closet" sends the same photo through the upload queue once', async () => {
  await render(<BuyCheckScreen />);
  await fromGallery();
  await fireEvent.press(await screen.findByRole('button', { name: 'Add to my closet' }));

  expect(mockEnqueue).toHaveBeenCalledTimes(1);
  expect(mockEnqueue).toHaveBeenCalledWith([PICKED]);
  expect(screen.getByText("Added: it's on its way to your closet.")).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Add to my closet' })).toBeNull();
});

test('a photo the queue could not take is not shown as added, and Add stays', async () => {
  mockEnqueue.mockReturnValue(0);
  await render(<BuyCheckScreen />);
  await fromGallery();
  await fireEvent.press(await screen.findByRole('button', { name: 'Add to my closet' }));

  expect(mockEnqueue).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Added: it's on its way to your closet.")).toBeNull();
  expect(screen.getByRole('button', { name: 'Add to my closet' })).toBeOnTheScreen();
});

async function fromCamera(): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: 'Take a photo' }));
  await screen.findByText('This would open 12 new outfits');
}

test('"Check another" deletes the camera shot from the cache', async () => {
  await render(<BuyCheckScreen />);
  await fromCamera();
  expect(mockedDelete).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'Check another' }));
  expect(mockedDelete).toHaveBeenCalledWith(SHOT);
});

test('leaving the screen deletes the camera shot, added or not (the queue keeps its own copy)', async () => {
  const first = await render(<BuyCheckScreen />);
  await fromCamera();
  await first.unmount();
  expect(mockedDelete).toHaveBeenCalledWith(SHOT);

  mockedDelete.mockClear();
  const second = await render(<BuyCheckScreen />);
  await fromCamera();
  await fireEvent.press(screen.getByRole('button', { name: 'Add to my closet' }));
  expect(mockEnqueue).toHaveBeenCalledWith([SHOT]);
  await second.unmount();
  expect(mockedDelete).toHaveBeenCalledWith(SHOT);
});

test('a camera shot the device cannot decode is deleted at once', async () => {
  mockedPrepare.mockRejectedValue(new Error('decode failed'));
  await render(<BuyCheckScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Take a photo' }));

  expect(await screen.findByText("Couldn't open that photo. Try another one.")).toBeOnTheScreen();
  expect(mockedDelete).toHaveBeenCalledWith(SHOT);
});

test('a photo picked from the gallery is never deleted', async () => {
  const view = await render(<BuyCheckScreen />);
  await fromGallery();
  await fireEvent.press(await screen.findByRole('button', { name: 'Check another' }));
  await view.unmount();
  expect(mockedDelete).not.toHaveBeenCalled();
});

test('"Check another" goes back to the start without keeping the result', async () => {
  await render(<BuyCheckScreen />);
  await fromGallery();
  await fireEvent.press(await screen.findByRole('button', { name: 'Check another' }));

  expect(screen.queryByText('This would open 12 new outfits')).toBeNull();
  expect(screen.getByRole('button', { name: 'From gallery' })).toBeOnTheScreen();
});

test('a photo that is not clothing says so', async () => {
  mockedCheck.mockResolvedValue({ ok: true, result: { kind: 'not_garment' } });
  await render(<BuyCheckScreen />);
  await fromGallery();

  expect(await screen.findByText("That doesn't look like clothing. Try a photo of just the piece.")).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Add to my closet' })).toBeNull();
});

test('over the quota there is no retry', async () => {
  mockedCheck.mockResolvedValue({ ok: false, error: 'over_quota' });
  await render(<BuyCheckScreen />);
  await fromGallery();

  expect(await screen.findByText("You've used today's 5 checks. Try again tomorrow.")).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

test('offline, "Try again" resends the same prepared photo without picking again', async () => {
  mockedCheck.mockResolvedValueOnce({ ok: false, error: 'network' });
  await render(<BuyCheckScreen />);
  await fromGallery();

  expect(await screen.findByText("Couldn't reach the AI. Check your internet and try again.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('This would open 12 new outfits')).toBeOnTheScreen();
  expect(mockedLibrary).toHaveBeenCalledTimes(1);
  expect(mockedPrepare).toHaveBeenCalledTimes(1);
  expect(mockedCheck).toHaveBeenCalledTimes(2);
});

test('a photo that cannot be read on the device is never sent', async () => {
  mockedPrepare.mockRejectedValue(new Error('decode failed'));
  await render(<BuyCheckScreen />);
  await fromGallery();

  expect(await screen.findByText("Couldn't open that photo. Try another one.")).toBeOnTheScreen();
  expect(mockedCheck).not.toHaveBeenCalled();
});

test('in Spanish', async () => {
  mockLocales.tags = ['es-CO'];
  mockedCheck.mockResolvedValue({ ok: true, result: result({ duplicates: [{ id: OWNED }], newOutfits: 2, verdict: 'skip' }) });
  await render(<BuyCheckScreen />);
  expect(screen.getByRole('header', { name: '¿Lo compro?' })).toBeOnTheScreen();
  expect(
    screen.getByText('Ni la app ni su servidor guardan la foto; Anthropic la trata según sus propias reglas de conservación.'),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'De la galería' }));

  expect(mockedCheck).toHaveBeenCalledWith(expect.objectContaining({ language: 'es' }));
  expect(await screen.findByText('Ya tienes algo muy parecido')).toBeOnTheScreen();
  expect(screen.getByText('2 outfits nuevos con tu clóset')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Agregar a mi clóset' })).toBeOnTheScreen();
});
