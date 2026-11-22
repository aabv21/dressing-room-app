import * as Haptics from 'expo-haptics';

import { tapHaptic } from '../feedback';

const impact = jest.mocked(Haptics.impactAsync);
const selection = jest.mocked(Haptics.selectionAsync);
const notify = jest.mocked(Haptics.notificationAsync);

beforeEach(() => {
  impact.mockReset().mockResolvedValue(undefined);
  selection.mockReset().mockResolvedValue(undefined);
  notify.mockReset().mockResolvedValue(undefined);
});

test('a success is a success notification', () => {
  tapHaptic('success');
  expect(notify).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  expect(impact).not.toHaveBeenCalled();
});

test('a commit tap is a light impact', () => {
  tapHaptic('commit');
  expect(impact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  expect(selection).not.toHaveBeenCalled();
});

test('a selection tap is a selection tick', () => {
  tapHaptic('selection');
  expect(selection).toHaveBeenCalledTimes(1);
  expect(impact).not.toHaveBeenCalled();
});

test('a device that rejects haptics neither throws nor leaves the rejection unhandled', async () => {
  impact.mockRejectedValue(new Error('no vibrator'));
  selection.mockImplementation(() => {
    throw new Error('not available');
  });
  expect(() => {
    tapHaptic('commit');
  }).not.toThrow();
  expect(() => {
    tapHaptic('selection');
  }).not.toThrow();
  await Promise.resolve();
});
