// The garment detail screen: edit any attribute, change the status, replace the photo, delete.
// Rendered directly with the closet, queue, repository and profile seams mocked.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Alert, type AlertButton } from 'react-native';

import GarmentDetailScreen from '../app/garment/[id]';
import { usePendingPolling } from '../closet/ClosetProvider';
import { deleteGarment, updateGarment, type Garment } from '../closet/garmentRepository';
import { garment } from '../test/garmentFixture';

const mockParams: { id: string } = { id: 'g-1' };
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => mockParams,
  useIsFocused: jest.fn(() => true),
}));

const mockCloset: { garments: Garment[]; status: 'loading' | 'ready' | 'offline' } = { garments: [], status: 'ready' };
const mockReplaceLocal = jest.fn();
const mockRemoveLocal = jest.fn();
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({
    garments: mockCloset.garments,
    thumbUrls: new Map(),
    status: mockCloset.status,
    refresh: () => Promise.resolve(),
    replaceLocal: mockReplaceLocal,
    removeLocal: mockRemoveLocal,
  }),
  usePendingPolling: jest.fn(),
}));

const mockQueue = { pending: 0 };
const mockEnqueueReplacement = jest.fn();
jest.mock('../closet/UploadQueueProvider', () => ({
  useUploadQueue: () => ({
    pending: mockQueue.pending,
    failed: 0,
    enqueue: jest.fn(),
    enqueueReplacement: mockEnqueueReplacement,
    retryFailed: jest.fn(),
    discardFailed: jest.fn(),
  }),
}));

jest.mock('../closet/garmentRepository', () => ({
  updateGarment: jest.fn(),
  deleteGarment: jest.fn(),
  garmentPhotoPath: (userId: string, id: string, variant: string) => `${userId}/${id}/${variant}.webp`,
  signedPhotoUrls: jest.fn((paths: string[]) => Promise.resolve(new Map(paths.map((path) => [path, `https://signed/${path}`])))),
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'user-1' }),
}));

jest.mock('../profile/profileRepository', () => ({
  getProfile: jest.fn(() => Promise.resolve({ clothing_type: 'everything' })),
}));

const mockedUpdateGarment = jest.mocked(updateGarment);
const mockedDeleteGarment = jest.mocked(deleteGarment);
const mockedCanGoBack = jest.mocked(router.canGoBack);

function jeans(overrides: Partial<Garment> = {}): Garment {
  return garment({
    id: 'g-1',
    extraction_status: 'done',
    reviewed_at: '2026-11-08T12:30:00.000Z',
    category: 'jeans',
    colors: ['navy'],
    pattern: 'solid',
    material: 'denim',
    formality: 2,
    seasons: ['spring', 'autumn'],
    warmth: 2,
    fit: 'regular',
    occasions: ['university'],
    wear_count: 3,
    photo_version: 2,
    ...overrides,
  });
}

const NETWORK_ERROR = "Couldn't save. Check your internet and try again.";

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.id = 'g-1';
  mockCloset.garments = [jeans()];
  mockCloset.status = 'ready';
  mockQueue.pending = 0;
  mockedCanGoBack.mockReturnValue(true);
});

async function renderDetail(): Promise<void> {
  await render(<GarmentDetailScreen />);
  // Let the photo signing and the profile read settle.
  await waitFor(() => {
    expect(screen.getByLabelText('Garment photo')).toBeOnTheScreen();
  });
}

/** Stubs `Alert.alert` and presses its destructive button. */
function confirmEveryAlert(): jest.SpyInstance {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });
}

test('shows the garment: title, full photo cached by version, wear count and status', async () => {
  await renderDetail();

  expect(screen.getByRole('header', { name: 'JEANS' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Garment photo').props.source).toEqual([
    expect.objectContaining({ uri: 'https://signed/user-1/g-1/full.webp', cacheKey: 'g-1:full:2' }),
  ]);
  expect(screen.getByText('3 wears')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Available' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Solid' })).toBeChecked();
});

test('editing the pattern and saving sends only the changed field', async () => {
  mockedUpdateGarment.mockResolvedValue({ ok: true });
  await renderDetail();

  await fireEvent.press(screen.getByRole('radio', { name: 'Striped' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => {
    expect(mockReplaceLocal).toHaveBeenCalledWith({ ...jeans(), pattern: 'striped' });
  });
  expect(mockedUpdateGarment).toHaveBeenCalledWith('g-1', { pattern: 'striped' });
});

test('Save is disabled until a value differs from the stored one', async () => {
  await renderDetail();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  await fireEvent.press(screen.getByRole('radio', { name: 'Striped' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

  // Back to the stored value: nothing to save again.
  await fireEvent.press(screen.getByRole('radio', { name: 'Solid' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('a network error keeps the edited value and shows the message', async () => {
  mockedUpdateGarment.mockResolvedValue({ ok: false, error: 'network' });
  await renderDetail();

  await fireEvent.press(screen.getByRole('radio', { name: 'Striped' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText(NETWORK_ERROR)).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Striped' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(mockReplaceLocal).not.toHaveBeenCalled();
});

test('choosing "In the laundry" saves the status at once', async () => {
  mockedUpdateGarment.mockResolvedValue({ ok: true });
  await renderDetail();

  await fireEvent.press(screen.getByRole('radio', { name: 'In the laundry' }));

  expect(mockedUpdateGarment).toHaveBeenCalledWith('g-1', { status: 'laundry' });
  expect(screen.getByRole('radio', { name: 'In the laundry' })).toBeChecked();
  await waitFor(() => {
    expect(mockReplaceLocal).toHaveBeenCalledWith({ ...jeans(), status: 'laundry' });
  });
});

test('a status that fails to save reverts and shows the message', async () => {
  mockedUpdateGarment.mockResolvedValue({ ok: false, error: 'network' });
  await renderDetail();

  await fireEvent.press(screen.getByRole('radio', { name: 'In the laundry' }));

  expect(await screen.findByText(NETWORK_ERROR)).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Available' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'In the laundry' })).not.toBeChecked();
  expect(mockReplaceLocal).not.toHaveBeenCalled();
});

test('the selected status can not be cleared', async () => {
  await renderDetail();

  await fireEvent.press(screen.getByRole('radio', { name: 'Available' }));

  expect(screen.getByRole('radio', { name: 'Available' })).toBeChecked();
  expect(mockedUpdateGarment).not.toHaveBeenCalled();
});

test('delete asks first, then deletes, drops the garment locally and goes back', async () => {
  const alert = confirmEveryAlert();
  mockedDeleteGarment.mockResolvedValue({ ok: true });
  await renderDetail();

  await fireEvent.press(screen.getByRole('button', { name: 'Delete garment' }));

  expect(alert).toHaveBeenCalledWith('Delete this garment?', expect.any(String), expect.any(Array));
  await waitFor(() => {
    expect(router.back).toHaveBeenCalled();
  });
  expect(mockedDeleteGarment).toHaveBeenCalledWith('user-1', 'g-1');
  expect(mockRemoveLocal).toHaveBeenCalledWith('g-1');
  alert.mockRestore();
});

test('a deep-linked delete with no history lands on the closet', async () => {
  const alert = confirmEveryAlert();
  mockedDeleteGarment.mockResolvedValue({ ok: true });
  mockedCanGoBack.mockReturnValue(false);
  await renderDetail();

  await fireEvent.press(screen.getByRole('button', { name: 'Delete garment' }));

  await waitFor(() => {
    expect(router.replace).toHaveBeenCalledWith('/closet');
  });
  expect(router.back).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('cancelling the confirm deletes nothing', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await renderDetail();

  await fireEvent.press(screen.getByRole('button', { name: 'Delete garment' }));

  expect(alert).toHaveBeenCalled();
  expect(mockedDeleteGarment).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('a failed delete keeps the screen and shows the message', async () => {
  const alert = confirmEveryAlert();
  mockedDeleteGarment.mockResolvedValue({ ok: false, error: 'network' });
  await renderDetail();

  await fireEvent.press(screen.getByRole('button', { name: 'Delete garment' }));

  expect(await screen.findByText("Couldn't delete. Check your internet and try again.")).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'JEANS' })).toBeOnTheScreen();
  expect(mockRemoveLocal).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('Replace photo queues the picked photo as a replacement', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///new.jpg' }] as ImagePicker.ImagePickerAsset[],
  });
  await renderDetail();

  await fireEvent.press(screen.getByRole('button', { name: 'Replace photo' }));

  await waitFor(() => {
    expect(mockEnqueueReplacement).toHaveBeenCalledWith('g-1', 'file:///new.jpg');
  });
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  });
});

test('a cancelled picker queues nothing', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null });
  await renderDetail();

  await fireEvent.press(screen.getByRole('button', { name: 'Replace photo' }));

  await waitFor(() => {
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
  });
  expect(mockEnqueueReplacement).not.toHaveBeenCalled();
});

test('while the AI is still reading the photo, the editors are disabled and it polls', async () => {
  mockCloset.garments = [
    garment({ id: 'g-1', extraction_status: 'pending', created_at: new Date().toISOString() }),
  ];
  await renderDetail();

  expect(screen.getByText('Reading the photo…')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Striped' })).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'Hoodie' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  // The status is the user's, not the AI's: it stays editable.
  expect(screen.getByRole('radio', { name: 'Lent out' })).toBeEnabled();
  expect(usePendingPolling).toHaveBeenLastCalledWith(true);
});

test('a pending read over 10 minutes old counts as failed: the editors work', async () => {
  mockCloset.garments = [garment({ id: 'g-1', extraction_status: 'pending', created_at: '2020-01-01T00:00:00.000Z' })];
  await renderDetail();

  expect(screen.queryByText('Reading the photo…')).not.toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Striped' })).toBeEnabled();
  expect(usePendingPolling).toHaveBeenLastCalledWith(false);
});

test('an unknown id shows the not-found state, whose button goes back', async () => {
  mockParams.id = 'missing';
  await render(<GarmentDetailScreen />);

  expect(screen.getByText('This garment is no longer in your closet')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to closet' }));
  expect(router.back).toHaveBeenCalled();
});

test('an unknown id while the closet is still loading waits instead of saying not found', async () => {
  mockParams.id = 'missing';
  mockCloset.status = 'loading';
  await render(<GarmentDetailScreen />);

  expect(screen.queryByText('This garment is no longer in your closet')).not.toBeOnTheScreen();
});

type RequestResult = Awaited<ReturnType<typeof updateGarment>>;

function deferred(): { promise: Promise<RequestResult>; resolve: (result: RequestResult) => void } {
  let resolve: (result: RequestResult) => void = () => undefined;
  const promise = new Promise<RequestResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('category: required to save, and any category reachable in one tap', () => {
  test('clearing the category disables Save and shows a hint until one is picked', async () => {
    await renderDetail();

    await fireEvent.press(screen.getByRole('radio', { name: 'Jeans' }));

    expect(screen.getByText('Pick a category to save.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('radio', { name: 'Shorts' }));
    expect(screen.queryByText('Pick a category to save.')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('a T-shirt can become a jacket in one tap: every category is offered', async () => {
    mockCloset.garments = [jeans({ category: 't_shirt' })];
    mockedUpdateGarment.mockResolvedValue({ ok: true });
    await renderDetail();

    await fireEvent.press(screen.getByRole('radio', { name: 'Jacket' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(mockedUpdateGarment).toHaveBeenCalledWith('g-1', { category: 'jacket' });
  });
});

describe('saves never race', () => {
  test('a second status tap while one is saving is ignored, and the first one lands', async () => {
    const first = deferred();
    mockedUpdateGarment.mockReturnValueOnce(first.promise);
    await renderDetail();

    await fireEvent.press(screen.getByRole('radio', { name: 'In the laundry' }));
    expect(screen.getByRole('radio', { name: 'Lent out' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Lent out' }));

    first.resolve({ ok: true });
    await waitFor(() => {
      expect(mockReplaceLocal).toHaveBeenCalledWith({ ...jeans(), status: 'laundry' });
    });
    expect(mockedUpdateGarment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'In the laundry' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Lent out' })).toBeEnabled();
  });

  test('a failed status save reverts to the last confirmed status, not the first one', async () => {
    mockedUpdateGarment.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'network' });
    await renderDetail();

    await fireEvent.press(screen.getByRole('radio', { name: 'In the laundry' }));
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Lent out' })).toBeEnabled();
    });
    await fireEvent.press(screen.getByRole('radio', { name: 'Lent out' }));

    expect(await screen.findByText(NETWORK_ERROR)).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'In the laundry' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Lent out' })).not.toBeChecked();
  });

  test('delete is disabled while a save is in flight', async () => {
    const save = deferred();
    mockedUpdateGarment.mockReturnValueOnce(save.promise);
    await renderDetail();

    await fireEvent.press(screen.getByRole('radio', { name: 'Striped' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Delete garment' })).toBeDisabled();

    save.resolve({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete garment' })).toBeEnabled();
    });
  });

  test('delete is disabled while a status save is in flight', async () => {
    const save = deferred();
    mockedUpdateGarment.mockReturnValueOnce(save.promise);
    await renderDetail();

    await fireEvent.press(screen.getByRole('radio', { name: 'Lent out' }));
    expect(screen.getByRole('button', { name: 'Delete garment' })).toBeDisabled();

    save.resolve({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete garment' })).toBeEnabled();
    });
  });

  test('while deleting, Save and the status chips are disabled', async () => {
    const alert = confirmEveryAlert();
    let finish: (result: RequestResult) => void = () => undefined;
    mockedDeleteGarment.mockReturnValueOnce(
      new Promise<RequestResult>((done) => {
        finish = done;
      }),
    );
    await renderDetail();
    await fireEvent.press(screen.getByRole('radio', { name: 'Striped' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Delete garment' }));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Lent out' })).toBeDisabled();
    finish({ ok: false, error: 'network' });
    expect(await screen.findByText("Couldn't delete. Check your internet and try again.")).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    alert.mockRestore();
  });

  test('a status save that resolves after the screen is gone applies nothing', async () => {
    const save = deferred();
    mockedUpdateGarment.mockReturnValueOnce(save.promise);
    await renderDetail();

    await fireEvent.press(screen.getByRole('radio', { name: 'In the laundry' }));
    await screen.unmount();
    save.resolve({ ok: true });
    await Promise.resolve();

    expect(mockReplaceLocal).not.toHaveBeenCalled();
  });
});

describe('one save at a time (fix round 2)', () => {
  test('Save is disabled while a status save is in flight', async () => {
    const status = deferred();
    mockedUpdateGarment.mockReturnValueOnce(status.promise);
    await renderDetail();

    await fireEvent.press(screen.getByRole('radio', { name: 'Striped' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Lent out' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    status.resolve({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });

  test('the status chips are disabled while a field save is in flight', async () => {
    const save = deferred();
    mockedUpdateGarment.mockReturnValueOnce(save.promise);
    await renderDetail();

    await fireEvent.press(screen.getByRole('radio', { name: 'Striped' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('radio', { name: 'Lent out' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Lent out' }));
    expect(mockedUpdateGarment).toHaveBeenCalledTimes(1);

    save.resolve({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Lent out' })).toBeEnabled();
    });
  });
});

describe('donated: not offered by the status picker', () => {
  test('the status picker offers available, laundry and lent only', async () => {
    await renderDetail();

    expect(screen.getByRole('radio', { name: 'Available' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'In the laundry' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Lent out' })).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Donated' })).not.toBeOnTheScreen();
  });

  test('a donated garment shows a read-only "Donated" note instead of the picker', async () => {
    mockCloset.garments = [jeans({ status: 'donated' })];
    await renderDetail();

    expect(screen.getByText('Donated')).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Available' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('radiogroup', { name: 'Status' })).not.toBeOnTheScreen();
  });
});
