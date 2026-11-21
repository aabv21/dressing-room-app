import { fireEvent, render, screen } from '@testing-library/react-native';

import { OptionCard } from '../OptionCard';

test('the decorative emoji is capped for large text, leaving the width to the title and subtitle', async () => {
  await render(
    <OptionCard emoji="👗" title="Feminine" subtitle="Blouses, skirts, dresses…" selected={false} onPress={jest.fn()} />,
  );
  expect(screen.getByText('👗', { includeHiddenElements: true })).toHaveProp('maxFontSizeMultiplier', 1.3);
  expect(screen.getByText('Feminine')).not.toHaveProp('maxFontSizeMultiplier');
});

test('pressing an option is a selection tick and still selects it', async () => {
  const Haptics = jest.requireMock<typeof import('expo-haptics')>('expo-haptics');
  jest.mocked(Haptics.selectionAsync).mockClear();
  const onPress = jest.fn();
  await render(<OptionCard emoji="👗" title="Feminine" subtitle="Blouses" selected={false} onPress={onPress} />);
  await fireEvent.press(screen.getByRole('radio'));
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  expect(onPress).toHaveBeenCalledTimes(1);
});
