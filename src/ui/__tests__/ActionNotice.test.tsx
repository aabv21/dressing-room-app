import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActionNotice, UndoNotice } from '../ActionNotice';

test('an error is an alert that screen readers hear', async () => {
  await render(<ActionNotice tone="error">Couldn't connect.</ActionNotice>);

  const notice = screen.getByRole('alert');
  expect(notice).toHaveTextContent("Couldn't connect.");
  expect(notice).toHaveProp('accessibilityLiveRegion', 'polite');
});

test('a queued note is announced politely, not as an alert', async () => {
  await render(<ActionNotice tone="queued">Logged — it syncs later.</ActionNotice>);

  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Logged — it syncs later.')).toHaveProp('accessibilityLiveRegion', 'polite');
});

test('Undo is a named button with a hint that calls back on press', async () => {
  const onPress = jest.fn();
  await render(<UndoNotice label="Undo" hint="Removes this wear from your diary" onPress={onPress} />);

  const button = screen.getByRole('button', { name: 'Undo' });
  expect(button).toHaveProp('accessibilityHint', 'Removes this wear from your diary');
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});
