import { render, screen } from '@testing-library/react-native';

import { GoalCard } from '../GoalCard';

const none = { top: false, bottom: false, onePiece: false, shoes: false, complete: false };

test('the steps wrap under the title at a large text size, and the bar reads the steps done', async () => {
  await render(<GoalCard progress={{ ...none, top: true }} />);
  expect(screen.getByText('Your first outfit').parent).toHaveStyle({ flexWrap: 'wrap' });
  expect(screen.getByRole('progressbar', { name: 'Your first outfit' })).toHaveProp('accessibilityValue', {
    min: 0,
    max: 3,
    now: 1,
    text: '1 of 3',
  });
});

test('a one-piece counts as the top and the bottom', async () => {
  await render(<GoalCard progress={{ ...none, onePiece: true }} />);
  expect(screen.getByRole('progressbar', { name: 'Your first outfit' })).toHaveProp(
    'accessibilityValue',
    expect.objectContaining({ now: 2, text: '2 of 3' }),
  );
});

test('each step says whether it is done', async () => {
  await render(<GoalCard progress={{ ...none, top: true, shoes: true }} />);
  expect(screen.getByLabelText('Top, done')).toBeOnTheScreen();
  expect(screen.getByLabelText('Bottom, to do')).toBeOnTheScreen();
  expect(screen.getByLabelText('Shoes, done')).toBeOnTheScreen();
  expect(screen.getByText('or a dress')).toBeOnTheScreen();
});
