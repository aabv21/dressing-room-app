// Mockup 02 screen 2: a dark full-screen burst camera, one garment per shot, no forms. Rendered
// directly (not through the real route tree) since this suite only exercises the screen's own
// behavior — permissions, the shutter, the shot strip/counter, Done and Close — all of which are
// seams this component owns itself.
import { Alert, Linking } from 'react-native';

let mockTakePictureAsync: jest.Mock<Promise<{ uri: string }>, [options?: unknown]>;
let mockPermissionState: { granted: boolean; status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean } | null;
const mockRequestPermission = jest.fn();

// expo-camera's `CameraView` is a class component whose `takePictureAsync` is called imperatively
// through a ref (see its .d.ts: `_cameraRef`/instance methods, not a prop). The mock exposes the
// same imperative shape via `forwardRef` + `useImperativeHandle` so the screen's own ref code path
// is exercised exactly as it will be against the real native view.
jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const MockCameraView = React.forwardRef(function MockCameraView(
    props: { facing?: string },
    ref: React.Ref<{ takePictureAsync: (options?: unknown) => Promise<{ uri: string }> }>,
  ) {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: (options?: unknown) => mockTakePictureAsync(options),
    }));
    return null;
  });
  return {
    CameraView: MockCameraView,
    useCameraPermissions: () => [mockPermissionState, mockRequestPermission],
  };
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CameraScreen from '../app/camera';
import { useUploadQueue } from '../closet/UploadQueueProvider';

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

const mockEnqueue = jest.fn();
jest.mock('../closet/UploadQueueProvider', () => ({
  useUploadQueue: jest.fn(),
}));

// Re-declared here (not imported from `expo-router`'s mock above) because the module mock factory
// cannot close over an outer-scope binding.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
const mockRouter = (require('expo-router') as { router: { back: jest.Mock } }).router;

const mockedUseUploadQueue = jest.mocked(useUploadQueue);

beforeEach(() => {
  jest.clearAllMocks();
  mockTakePictureAsync = jest.fn(() => Promise.resolve({ uri: 'file:///shot.jpg' }));
  mockPermissionState = { granted: true, status: 'granted', canAskAgain: true };
  mockedUseUploadQueue.mockReturnValue({
    pending: 0,
    failed: 0,
    enqueue: mockEnqueue,
    enqueueReplacement: jest.fn(),
    retryFailed: jest.fn(),
    discardFailed: jest.fn(),
  });
});

describe('granted', () => {
  test('tapping the shutter twice shows "2 photos" and "Done, process 2"', async () => {
    await render(<CameraScreen />);

    await fireEvent.press(screen.getByTestId('camera-shutter'));
    await waitFor(() => {
      expect(screen.getByText('1 photo')).toBeOnTheScreen();
    });
    await fireEvent.press(screen.getByTestId('camera-shutter'));

    await waitFor(() => {
      expect(screen.getByText('2 photos')).toBeOnTheScreen();
    });
    expect(screen.getByRole('button', { name: 'Done, process 2' })).toBeOnTheScreen();
  });

  test('a second tap while the first capture is pending is ignored', async () => {
    let resolveFirst: ((picture: { uri: string }) => void) | undefined;
    mockTakePictureAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    await render(<CameraScreen />);

    await fireEvent.press(screen.getByTestId('camera-shutter'));
    await fireEvent.press(screen.getByTestId('camera-shutter'));

    expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
    resolveFirst?.({ uri: 'file:///shot.jpg' });
    await waitFor(() => {
      expect(screen.getByText('1 photo')).toBeOnTheScreen();
    });
  });

  test('Done calls enqueue with both shot URIs and then goes back', async () => {
    mockTakePictureAsync
      .mockResolvedValueOnce({ uri: 'file:///a.jpg' })
      .mockResolvedValueOnce({ uri: 'file:///b.jpg' });
    await render(<CameraScreen />);

    await fireEvent.press(screen.getByTestId('camera-shutter'));
    await waitFor(() => {
      expect(screen.getByText('1 photo')).toBeOnTheScreen();
    });
    await fireEvent.press(screen.getByTestId('camera-shutter'));
    await waitFor(() => {
      expect(screen.getByText('2 photos')).toBeOnTheScreen();
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Done, process 2' }));

    expect(mockEnqueue).toHaveBeenCalledWith(['file:///a.jpg', 'file:///b.jpg']);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('Close with 0 shots goes back directly', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<CameraScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));

    expect(alert).not.toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('Close with 1 shot shows a Discard / Keep shooting alert', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<CameraScreen />);

    await fireEvent.press(screen.getByTestId('camera-shutter'));
    await waitFor(() => {
      expect(screen.getByText('1 photo')).toBeOnTheScreen();
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));

    expect(alert).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    expect(buttons.map((button) => button.text)).toEqual(['Keep shooting', 'Discard']);
    buttons.find((button) => button.text === 'Discard')?.onPress?.();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});

describe('denied', () => {
  test('shows the settings button, and pressing it calls Linking.openSettings', async () => {
    mockPermissionState = { granted: false, status: 'denied', canAskAgain: false };
    const openSettings = jest.spyOn(Linking, 'openSettings').mockImplementation(() => Promise.resolve());
    await render(<CameraScreen />);

    const settingsButton = screen.getByRole('button', { name: 'Open settings' });
    expect(settingsButton).toBeOnTheScreen();

    await fireEvent.press(settingsButton);

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('camera-shutter')).not.toBeOnTheScreen();
  });
});

describe('undetermined', () => {
  test('requests permission instead of showing the settings button', async () => {
    mockPermissionState = { granted: false, status: 'undetermined', canAskAgain: true };
    await render(<CameraScreen />);

    await waitFor(() => {
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('button', { name: 'Open settings' })).not.toBeOnTheScreen();
  });
});
