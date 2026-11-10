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

// `usePreventRemove`'s real implementation hooks into the navigator's `beforeRemove` event (back
// gesture, hardware back, swipe-dismiss) — none of which this render-only suite can trigger. The
// mock instead records the latest (preventRemove, callback) pair so a test can simulate "the user
// tried to leave" by invoking the stored callback directly, exactly as expo-router would when a
// real removal attempt fires while `preventRemove` is true. Its returned `disablePrevention`
// mirrors the real hook's own doc ("call the returned disablePrevention function, and then
// navigate"): calling it clears the stored callback, so a later `attemptRemove()` is a no-op,
// exactly as a real screen that's no longer preventing removal would let any removal through.
let mockPreventRemoveCallback: ((options: { repeat: () => void }) => void) | undefined;
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  usePreventRemove: (preventRemove: boolean, callback?: (options: { repeat: () => void }) => void) => {
    mockPreventRemoveCallback = preventRemove ? callback : undefined;
    return () => {
      mockPreventRemoveCallback = undefined;
    };
  },
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

/** Simulates a real removal attempt (back gesture/button, hardware back, swipe-dismiss). */
function attemptRemove(): void {
  mockPreventRemoveCallback?.({ repeat: () => undefined });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPreventRemoveCallback = undefined;
  mockTakePictureAsync = jest.fn(() => Promise.resolve({ uri: 'file:///shot.jpg' }));
  mockPermissionState = { granted: true, status: 'granted', canAskAgain: true };
  mockedUseUploadQueue.mockReturnValue({
    pending: 0,
    failed: 0,
    enqueue: mockEnqueue,
    enqueueReplacement: jest.fn(),
    retryFailed: jest.fn(),
    discardFailed: jest.fn(),
    pause: jest.fn(() => Promise.resolve()),
    clear: jest.fn(),
    resume: jest.fn(),
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

  test('a rejected capture shows a message, keeps the count unchanged, and the next tap captures again', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockTakePictureAsync
      .mockRejectedValueOnce(new Error('camera hardware error'))
      .mockResolvedValueOnce({ uri: 'file:///a.jpg' });
    await render(<CameraScreen />);

    await fireEvent.press(screen.getByTestId('camera-shutter'));

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith("Couldn't take that photo. Try again.");
    });
    expect(screen.queryByText('1 photo')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('camera-shutter'));

    await waitFor(() => {
      expect(screen.getByText('1 photo')).toBeOnTheScreen();
    });
    expect(mockTakePictureAsync).toHaveBeenCalledTimes(2);
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

  test('a back/remove attempt with 1 shot shows the Discard / Keep shooting alert', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<CameraScreen />);

    await fireEvent.press(screen.getByTestId('camera-shutter'));
    await waitFor(() => {
      expect(screen.getByText('1 photo')).toBeOnTheScreen();
    });

    attemptRemove();

    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    expect(buttons.map((button) => button.text)).toEqual(['Keep shooting', 'Discard']);
  });

  test('Discard on a back/remove attempt lets the removal continue', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<CameraScreen />);

    await fireEvent.press(screen.getByTestId('camera-shutter'));
    await waitFor(() => {
      expect(screen.getByText('1 photo')).toBeOnTheScreen();
    });

    let repeated = false;
    mockPreventRemoveCallback?.({ repeat: () => { repeated = true; } });

    const buttons = alert.mock.calls[0]?.[2] ?? [];
    buttons.find((button) => button.text === 'Discard')?.onPress?.();

    expect(repeated).toBe(true);
  });

  test('Keep shooting on a back/remove attempt leaves the screen in place', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<CameraScreen />);

    await fireEvent.press(screen.getByTestId('camera-shutter'));
    await waitFor(() => {
      expect(screen.getByText('1 photo')).toBeOnTheScreen();
    });

    let repeated = false;
    mockPreventRemoveCallback?.({ repeat: () => { repeated = true; } });

    const buttons = alert.mock.calls[0]?.[2] ?? [];
    buttons.find((button) => button.text === 'Keep shooting')?.onPress?.();

    expect(repeated).toBe(false);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('a back/remove attempt with 0 shots is never prevented', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<CameraScreen />);

    expect(mockPreventRemoveCallback).toBeUndefined();
    expect(alert).not.toHaveBeenCalled();
  });

  test('after Done, a back/remove attempt is never prevented', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<CameraScreen />);

    await fireEvent.press(screen.getByTestId('camera-shutter'));
    await waitFor(() => {
      expect(screen.getByText('1 photo')).toBeOnTheScreen();
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Done, process 1' }));

    await waitFor(() => {
      expect(mockPreventRemoveCallback).toBeUndefined();
    });
    expect(alert).not.toHaveBeenCalled();
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
