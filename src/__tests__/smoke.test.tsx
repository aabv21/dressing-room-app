import { render, screen } from '@testing-library/react-native';

import Index from '../app/index';

test('renders the app name', async () => {
  await render(<Index />);
  expect(screen.getByText('Dressing Room')).toBeOnTheScreen();
});
