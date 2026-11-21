import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { shareOutfitImage } from '../shareOutfit';

jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const mockedCapture = jest.mocked(captureRef);
const mockedAvailable = jest.mocked(Sharing.isAvailableAsync);
const mockedShare = jest.mocked(Sharing.shareAsync);
const TARGET = { current: null };

beforeEach(() => {
  mockedCapture.mockReset();
  mockedCapture.mockResolvedValue('file:///cache/ReactNative-snapshot-image123.png');
  mockedAvailable.mockReset();
  mockedAvailable.mockResolvedValue(true);
  mockedShare.mockReset();
  mockedShare.mockResolvedValue(undefined);
});

test('captures the card as a PNG file and shares that file', async () => {
  expect(await shareOutfitImage(TARGET, 'Share this outfit')).toBe('shared');

  expect(mockedCapture).toHaveBeenCalledWith(TARGET, { format: 'png', quality: 1, result: 'tmpfile' });
  expect(mockedShare).toHaveBeenCalledWith('file:///cache/ReactNative-snapshot-image123.png', {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: 'Share this outfit',
  });
});

test('no sharing on the device answers unavailable without capturing', async () => {
  mockedAvailable.mockResolvedValue(false);

  expect(await shareOutfitImage(TARGET, 'Share this outfit')).toBe('unavailable');
  expect(mockedCapture).not.toHaveBeenCalled();
  expect(mockedShare).not.toHaveBeenCalled();
});

test('a failed capture answers failed and shares nothing', async () => {
  mockedCapture.mockRejectedValue(new Error('view not laid out'));

  expect(await shareOutfitImage(TARGET, 'Share this outfit')).toBe('failed');
  expect(mockedShare).not.toHaveBeenCalled();
});

test('a failed share sheet answers failed', async () => {
  mockedShare.mockRejectedValue(new Error('sheet failed'));

  expect(await shareOutfitImage(TARGET, 'Share this outfit')).toBe('failed');
});
