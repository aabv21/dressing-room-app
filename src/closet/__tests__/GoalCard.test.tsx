import { render, screen } from '@testing-library/react-native';

import { GoalCard } from '../GoalCard';

test('the progress wraps under the title at a large text size instead of squeezing it', async () => {
  await render(<GoalCard count={3} />);
  expect(screen.getByText('Your 10 favorites').parent).toHaveStyle({ flexWrap: 'wrap' });
  expect(screen.getByRole('progressbar', { name: 'Your 10 favorites' })).toHaveProp('accessibilityValue', {
    min: 0,
    max: 10,
    now: 3,
    text: '3/10',
  });
});
