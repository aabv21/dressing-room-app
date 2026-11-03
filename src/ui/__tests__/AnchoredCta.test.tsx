import { fireEvent, render, screen } from '@testing-library/react-native';
import { Check, Shuffle } from 'lucide-react-native';

import { AnchoredCta } from '../AnchoredCta';

test('renders primary and secondary as accessible buttons and fires presses', async () => {
  const wear = jest.fn();
  const another = jest.fn();
  await render(
    <AnchoredCta
      primary={{ label: 'Me lo pongo', tone: 'commit', icon: Check, onPress: wear }}
      secondary={{ label: 'Otro', tone: 'ghost', icon: Shuffle, onPress: another }}
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Me lo pongo' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Otro' }));
  expect(wear).toHaveBeenCalledTimes(1);
  expect(another).toHaveBeenCalledTimes(1);
});

test('a disabled action exposes disabled state and ignores presses', async () => {
  const onPress = jest.fn();
  await render(<AnchoredCta primary={{ label: '¿Cómo se ve?', tone: 'ai', onPress, disabled: true }} />);
  const button = screen.getByRole('button', { name: '¿Cómo se ve?' });
  expect(button).toBeDisabled();
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});
