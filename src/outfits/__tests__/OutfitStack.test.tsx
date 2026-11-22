import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { garment } from '../../test/garmentFixture';
import { colors } from '../../ui/theme';
import { OutfitStack } from '../OutfitStack';

test('a piece label wraps to a second line at a large text size instead of cutting off its color', async () => {
  await render(
    <OutfitStack
      garments={[garment({ id: 'g1', category: 'sweater', colors: ['camel'], extraction_status: 'done' })]}
      thumbUrls={new Map()}
    />,
  );
  expect(screen.getByText('Sweater · Camel')).toHaveProp('numberOfLines', 2);
});

test('a thumbnail sits on a neutral fill inside a hairline border, so a white garment still shows', async () => {
  await render(
    <OutfitStack
      garments={[garment({ id: 'g1', category: 't_shirt', colors: ['white'], extraction_status: 'done' })]}
      thumbUrls={new Map([['g1', 'https://signed/g1']])}
    />,
  );
  const thumb = StyleSheet.flatten(screen.getByTestId('outfit-thumb-g1').props.style) as Record<string, unknown>;
  expect(thumb).toMatchObject({ backgroundColor: colors.thumbFill, borderColor: colors.hairline });
  expect(thumb.borderWidth).toBeGreaterThan(0);
  expect(colors.thumbFill).not.toBe(colors.tint);
});
