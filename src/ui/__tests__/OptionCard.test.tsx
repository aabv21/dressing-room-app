import { render, screen } from '@testing-library/react-native';

import { OptionCard } from '../OptionCard';

test('the decorative emoji is capped for large text, leaving the width to the title and subtitle', async () => {
  await render(
    <OptionCard emoji="👗" title="Feminine" subtitle="Blouses, skirts, dresses…" selected={false} onPress={jest.fn()} />,
  );
  expect(screen.getByText('👗', { includeHiddenElements: true })).toHaveProp('maxFontSizeMultiplier', 1.3);
  expect(screen.getByText('Feminine')).not.toHaveProp('maxFontSizeMultiplier');
});
