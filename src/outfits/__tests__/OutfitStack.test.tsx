import { render, screen } from '@testing-library/react-native';

import { garment } from '../../test/garmentFixture';
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
