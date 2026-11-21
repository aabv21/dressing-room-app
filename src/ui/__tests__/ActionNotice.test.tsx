import { render, screen } from '@testing-library/react-native';

import { ActionNotice } from '../ActionNotice';

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
