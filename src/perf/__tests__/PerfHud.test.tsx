import { fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { PerfHud } from '../PerfHud';

const stats = { frames: 1200, dropped: 6, droppedRatio: 0.005, p95Ms: 8.4, medianMs: 8.33 };

afterEach(() => {
  jest.restoreAllMocks();
});

test('shows the median frame time and the refresh rate it implies', async () => {
  await render(<PerfHud stats={stats} onReset={jest.fn()} />);
  expect(screen.getByText('1,200 frames · 6 dropped (0.5%)\np95 8.4 ms · median 8.3 ms ≈ 120 Hz')).toBeOnTheScreen();
});

test('tap resets the stats', async () => {
  const onReset = jest.fn();
  await render(<PerfHud stats={stats} onReset={onReset} />);
  await fireEvent.press(screen.getByTestId('perf-hud'));
  expect(onReset).toHaveBeenCalledTimes(1);
});

test('long-press clears the image caches, resets the stats and confirms it', async () => {
  const clearMemory = jest.spyOn(Image, 'clearMemoryCache').mockResolvedValue(true);
  const clearDisk = jest.spyOn(Image, 'clearDiskCache').mockResolvedValue(true);
  const onReset = jest.fn();
  await render(<PerfHud stats={stats} onReset={onReset} />);

  await fireEvent(screen.getByTestId('perf-hud'), 'longPress');

  expect(clearMemory).toHaveBeenCalledTimes(1);
  expect(clearDisk).toHaveBeenCalledTimes(1);
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Image cache cleared · stats reset')).toBeOnTheScreen();
});

test('long-press reports a cache that could not be cleared', async () => {
  jest.spyOn(Image, 'clearMemoryCache').mockResolvedValue(true);
  jest.spyOn(Image, 'clearDiskCache').mockRejectedValue(new Error('no activity'));
  await render(<PerfHud stats={stats} onReset={jest.fn()} />);

  await fireEvent(screen.getByTestId('perf-hud'), 'longPress');

  expect(await screen.findByText("Couldn't clear the image cache")).toBeOnTheScreen();
});
