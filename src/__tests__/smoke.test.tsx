import { render, screen } from '@testing-library/react-native';

import TodayScreen from '../app/(tabs)/index';

test('renders the Today screen', async () => {
  await render(<TodayScreen />);
  expect(screen.getByText('TODAY')).toBeOnTheScreen();
});
