import { render, screen } from '@testing-library/react-native';

import { BodySection } from '../ProfileForm';
import { draftFromProfile } from '../profileDraft';

// The device's text size (iOS Dynamic Type, Android font scale). Jest's own default is 2.
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

test('body types sit three to a row at the default text size, one to a row at the largest so no word breaks', async () => {
  const value = draftFromProfile({ clothing_type: 'feminine' });
  await render(<BodySection value={value} onChange={jest.fn()} />);
  expect(screen.getByTestId('body-inverted_triangle')).toHaveStyle({ flexBasis: '30%' });
  expect(screen.getByTestId('body-helper')).toHaveStyle({ flexBasis: '30%' });

  mockWindow.fontScale = 3.1;
  await screen.rerender(<BodySection value={value} onChange={jest.fn()} />);
  expect(screen.getByTestId('body-inverted_triangle')).toHaveStyle({ flexBasis: '100%' });
  expect(screen.getByTestId('body-helper')).toHaveStyle({ flexBasis: '100%' });
});

test('the height label and value wrap onto two lines at a large text size instead of running off the card', async () => {
  mockWindow.fontScale = 3.1;
  await render(<BodySection value={draftFromProfile({ clothing_type: 'feminine' })} onChange={jest.fn()} unsetHeight="notSet" />);
  expect(screen.getByTestId('body-height-row')).toHaveStyle({ flexWrap: 'wrap' });
});
