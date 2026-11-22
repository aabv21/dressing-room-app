// The dictation hook on its own: two mics sharing the one recognizer, and a mic that goes away while
// the permission prompt is open.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { I18nProvider } from '../../i18n/I18nProvider';
import { emitRecognition, hear, recognition } from '../../test/dictation';
import { useDictation } from '../dictation';
import { MicButton } from '../MicButton';

function Mic({ name }: { name: string }): React.JSX.Element {
  const dictation = useDictation((text) => {
    heardBy.push(`${name}: ${text}`);
  });
  return (
    <>
      <MicButton dictation={dictation} label={name} />
      <Text testID={`${name}-problem`}>{dictation.problem ?? 'none'}</Text>
    </>
  );
}

let heardBy: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  heardBy = [];
});

test("a mic taking over aborts the other's session, and that session's late end doesn't stop the new one", async () => {
  await render(
    <I18nProvider>
      <Mic name="City" />
      <Mic name="Occasion" />
    </I18nProvider>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'City' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Occasion' }));
  expect(recognition.abort).toHaveBeenCalledTimes(1);

  // The aborted session reports its end after the new one started.
  await act(() => {
    emitRecognition('error', { error: 'aborted', message: '' });
    emitRecognition('end');
  });

  expect(screen.getAllByRole('button', { name: 'Stop listening' })).toHaveLength(1);
  expect(screen.getByTestId('Occasion-problem')).toHaveTextContent('none');

  await act(() => {
    hear('trabajo');
  });
  expect(heardBy).toEqual(['Occasion: trabajo']);
});

test("a mic unmounted while the permission prompt is open doesn't start listening", async () => {
  let grant: (value: { granted: boolean; canAskAgain: boolean; status: string; expires: string }) => void = () => undefined;
  recognition.requestPermissionsAsync.mockReturnValueOnce(
    new Promise((resolve) => {
      grant = resolve;
    }),
  );
  const view = await render(
    <I18nProvider>
      <Mic name="City" />
    </I18nProvider>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'City' }));

  await view.unmount();
  await act(async () => {
    grant({ granted: true, canAskAgain: true, status: 'granted', expires: 'never' });
    await Promise.resolve();
  });

  expect(recognition.start).not.toHaveBeenCalled();
});
