// The share sheet: "Share image" waits for the card's thumbnails (or 3 s), and the card scrolls
// inside the sheet instead of being cut off.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { garment } from '../../test/garmentFixture';
import { IMAGE_WAIT_MS, ShareOutfitSheet } from '../ShareOutfitSheet';

jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(() => Promise.resolve(true)), shareAsync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- see src/test/reanimatedMock.ts's module doc
jest.mock('react-native-reanimated', () => require('../../test/reanimatedMock'));

const TOP = garment({ id: 'top', category: 'blouse', extraction_status: 'done' });
const JEANS = garment({ id: 'jeans', category: 'jeans', extraction_status: 'done' });
const BOTH = new Map([
  ['top', 'https://signed/top'],
  ['jeans', 'https://signed/jeans'],
]);

async function renderSheet(thumbUrls: Map<string, string>): Promise<void> {
  await render(<ShareOutfitSheet visible garments={[TOP, JEANS]} thumbUrls={thumbUrls} score={80} onClose={jest.fn()} />);
}

// expo-image's native wrapper reads `nativeEvent` before calling the prop.
const loaded = () => ({ nativeEvent: { source: { url: '', width: 1, height: 1, mediaType: null } } });
const failed = () => ({ nativeEvent: { error: 'unreachable' } });

const shareButton = () => screen.getByRole('button', { name: 'Share image' });

beforeEach(() => {
  jest.mocked(captureRef).mockClear();
  jest.mocked(Sharing.shareAsync).mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

test('Share image waits until every thumbnail has loaded or failed', async () => {
  await renderSheet(BOTH);
  expect(shareButton()).toBeDisabled();

  await fireEvent.press(shareButton());
  expect(captureRef).not.toHaveBeenCalled();

  await fireEvent(screen.getByTestId('share-image-top'), 'load', loaded());
  expect(shareButton()).toBeDisabled();

  await fireEvent(screen.getByTestId('share-image-jeans'), 'error', failed());
  expect(shareButton()).toBeEnabled();

  await fireEvent.press(shareButton());
  expect(captureRef).toHaveBeenCalledTimes(1);
});

test('a piece with no thumbnail has nothing to wait for', async () => {
  await renderSheet(new Map([['top', 'https://signed/top']]));
  expect(shareButton()).toBeDisabled();

  await fireEvent(screen.getByTestId('share-image-top'), 'load', loaded());

  expect(shareButton()).toBeEnabled();
});

test('with no thumbnails at all it is ready at once', async () => {
  await renderSheet(new Map());

  expect(shareButton()).toBeEnabled();
});

test(`after ${String(IMAGE_WAIT_MS)} ms it is ready even if a thumbnail never answers`, async () => {
  jest.useFakeTimers();
  await renderSheet(BOTH);

  await act(async () => {
    jest.advanceTimersByTime(IMAGE_WAIT_MS - 1);
    await Promise.resolve();
  });
  expect(shareButton()).toBeDisabled();

  await act(async () => {
    jest.advanceTimersByTime(1);
    await Promise.resolve();
  });
  expect(shareButton()).toBeEnabled();
});

test('the card scrolls inside the sheet, so a tall look is never cut off', async () => {
  await renderSheet(BOTH);

  expect(within(screen.getByTestId('share-sheet-scroll')).getByTestId('share-card')).toBeOnTheScreen();
});
