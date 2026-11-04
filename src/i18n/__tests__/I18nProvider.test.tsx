import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import { I18nProvider, useLocalePreference } from '../I18nProvider';
import { useI18n } from '../index';

const LOCALE_PREFERENCE_KEY = 'locale-preference';

beforeEach(() => {
  kvRemove(LOCALE_PREFERENCE_KEY);
});

function Probe(): React.JSX.Element {
  const { locale, t } = useI18n();
  const { preference, setPreference } = useLocalePreference();
  return (
    <>
      <Text testID="locale">{locale}</Text>
      <Text testID="preference">{preference}</Text>
      <Text testID="closet">{t('tabs.closet')}</Text>
      <Text testID="set-es" onPress={() => { setPreference('es'); }}>
        set-es
      </Text>
    </>
  );
}

test('defaults to system, resolving en from the mocked device locale', async () => {
  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByTestId('preference')).toHaveTextContent('system');
  expect(screen.getByTestId('locale')).toHaveTextContent('en');
  expect(screen.getByTestId('closet')).toHaveTextContent('Closet');
});

test('setPreference("es") switches translations and persists the value', async () => {
  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );

  await fireEvent.press(screen.getByTestId('set-es'));

  expect(screen.getByTestId('preference')).toHaveTextContent('es');
  expect(screen.getByTestId('locale')).toHaveTextContent('es');
  expect(screen.getByTestId('closet')).toHaveTextContent('Clóset');
  expect(kvGet(LOCALE_PREFERENCE_KEY)).toBe('es');
});

test('a remount reads the persisted preference back', async () => {
  const { unmount } = await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  await fireEvent.press(screen.getByTestId('set-es'));
  await unmount();

  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByTestId('preference')).toHaveTextContent('es');
  expect(screen.getByTestId('closet')).toHaveTextContent('Clóset');
});

test('an unknown stored value falls back to system', async () => {
  kvSet(LOCALE_PREFERENCE_KEY, 'fr');

  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByTestId('preference')).toHaveTextContent('system');
  expect(screen.getByTestId('locale')).toHaveTextContent('en');
});
