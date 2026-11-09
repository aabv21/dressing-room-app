// The Profile tab's Privacy section through the REAL route tree: data export (the function, the
// file in the cache directory, the share sheet) and account deletion (the two confirms, the upload
// queue, the function, the device cleanup and the local sign-out), with every seam mocked.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('../closet/ClosetProvider', () => require('../test/closetProvidersMock'));

const mockQueue = {
  pause: jest.fn(() => Promise.resolve()),
  clear: jest.fn(),
  resume: jest.fn(),
};
jest.mock('../closet/UploadQueueProvider', () => ({
  UploadQueueProvider: ({ children }: { children?: React.ReactNode }) => children,
  useUploadQueue: () => ({
    pending: 0,
    failed: 0,
    enqueue: jest.fn(),
    enqueueReplacement: jest.fn(),
    retryFailed: jest.fn(),
    discardFailed: jest.fn(),
    pause: mockQueue.pause,
    clear: mockQueue.clear,
    resume: mockQueue.resume,
  }),
}));

jest.mock('../auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children?: React.ReactNode }) => children,
  useAuth: jest.fn(),
}));

jest.mock('../profile/profileRepository', () => ({
  getProfile: jest.fn(),
  saveProfile: jest.fn(),
  completeOnboarding: jest.fn(),
}));

jest.mock('../account/accountClient', () => ({
  deleteAccount: jest.fn(),
  exportData: jest.fn(),
  exportFileName: jest.fn(() => 'dressing-room-export-2026-11-09.json'),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

const mockWrite = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
const mockDeleted: string[] = [];
/** The names in the fake cache directory, listed as files. */
const mockCacheNames: string[] = [];
jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    name: string;
    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
      this.name = this.uri.slice(this.uri.lastIndexOf('/') + 1);
    }
    write(content: string): Promise<void> {
      return mockWrite(content);
    }
    delete(): void {
      mockDeleted.push(this.name);
    }
  }
  return {
    File: MockFile,
    Directory: jest.fn(),
    Paths: {
      cache: { uri: 'file:///cache', list: () => mockCacheNames.map((name) => new MockFile(`file:///cache/${name}`)) },
      document: { uri: 'file:///document' },
    },
  };
});

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('../auth/authService', () => ({
  signUpWithEmail: jest.fn(),
  signInWithEmail: jest.fn(),
  requestPasswordReset: jest.fn(),
  confirmPasswordReset: jest.fn(),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  signOut: jest.fn(() => Promise.resolve({ ok: true })),
  signOutLocally: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 2 },
}));

jest.mock('expo-location', () => ({
  Accuracy: { Low: 2 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { renderRouter } from 'expo-router/testing-library';

import { deleteAccount, exportData } from '../account/accountClient';
import type { DataExport } from '../account/accountClient';
import { deletionState } from '../account/deletionMarker';
import { useAuth } from '../auth/AuthProvider';
import { signOut, signOutLocally } from '../auth/authService';
import { kvGet, kvKeys, kvRemove, kvSet } from '../lib/kv';
import { getProfile } from '../profile/profileRepository';
import type { Profile } from '../profile/profileRepository';

const mockedUseAuth = jest.mocked(useAuth);
const mockedGetProfile = jest.mocked(getProfile);
const mockedDeleteAccount = jest.mocked(deleteAccount);
const mockedExportData = jest.mocked(exportData);
const mockedShare = jest.mocked(Sharing.shareAsync);
const mockedSignOutLocally = jest.mocked(signOutLocally);

const USER_ID = '0b7f6d7e-1111-4c4c-9a9a-000000000001';
const USER_KEYS = [
  `closet.v1.${USER_ID}`,
  `outfit.worn.${USER_ID}`,
  `today.lucky.${USER_ID}`,
  `forYou.ideas.${USER_ID}`,
  `today.occasion.${USER_ID}.2026-11-09`,
];

const EXPORT: DataExport = {
  exportedAt: '2026-11-09T12:00:00.000Z',
  profile: { user_id: USER_ID },
  garments: [],
  outfits: [],
  wears: [],
  photos: [],
};

function profileRow(): Profile {
  return {
    user_id: USER_ID,
    clothing_type: 'feminine',
    body_type: 'hourglass',
    height_cm: 168,
    chest_cm: null,
    waist_cm: null,
    hips_cm: null,
    top_size: null,
    bottom_size: null,
    shoe_size: null,
    age_group: null,
    styles: [],
    occasions: [],
    city_name: null,
    city_lat: null,
    city_lon: null,
    language: null,
    onboarding_completed_at: '2026-11-01T00:00:00Z',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  };
}

async function openProfile() {
  mockedGetProfile.mockResolvedValue(profileRow());
  await renderRouter({ appDir: 'src/app', overrides: {} }, { initialUrl: '/profile' });
  await screen.findByTestId('profile-form');
}

let alertSpy: jest.SpyInstance<void, Parameters<typeof Alert.alert>>;

/** The buttons of the `index`-th Alert shown so far. */
function alertButtons(index: number): AlertButton[] {
  const call = alertSpy.mock.calls.at(index);
  if (call === undefined) throw new Error(`no alert #${String(index)}`);
  return call[2] ?? [];
}

async function pressAlertButton(index: number, text: string): Promise<void> {
  const button = alertButtons(index).find((candidate) => candidate.text === text);
  if (button === undefined) throw new Error(`no "${text}" in alert #${String(index)}`);
  await act(async () => {
    button.onPress?.();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleted.length = 0;
  mockCacheNames.length = 0;
  for (const key of kvKeys()) kvRemove(key);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockedUseAuth.mockReturnValue({
    status: 'signedIn',
    userId: USER_ID,
    email: 'ana@example.com',
    onboardingComplete: true,
    refreshProfile: jest.fn(() => Promise.resolve(true)),
  });
  for (const key of USER_KEYS) kvSet(key, 'x');
});

afterEach(() => {
  alertSpy.mockRestore();
});

test('shows the privacy note, Export my data and a destructive Delete account', async () => {
  await openProfile();

  expect(screen.getByRole('header', { name: 'PRIVACY' })).toBeTruthy();
  expect(screen.getByText(/visible only to you/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Export my data' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Delete account' })).toBeTruthy();
});

describe('Export my data', () => {
  test('replaces earlier exports in the cache directory and opens the share sheet', async () => {
    mockedExportData.mockResolvedValue({ ok: true, result: EXPORT });
    mockCacheNames.push('dressing-room-export-2026-11-01.json', 'other.json');
    await openProfile();

    await fireEvent.press(screen.getByRole('button', { name: 'Export my data' }));

    await waitFor(() => {
      expect(mockedShare).toHaveBeenCalledTimes(1);
    });
    expect(mockWrite).toHaveBeenCalledWith(JSON.stringify(EXPORT, null, 2));
    const [uri, options] = mockedShare.mock.calls[0] ?? [];
    expect(uri).toBe('file:///cache/dressing-room-export-2026-11-09.json');
    expect(options).toEqual({ mimeType: 'application/json', UTI: 'public.json' });
    expect(mockDeleted).toEqual(['dressing-room-export-2026-11-01.json']);
  });

  test('without a share sheet on the device, says so and exports nothing', async () => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
    await openProfile();

    await fireEvent.press(screen.getByRole('button', { name: 'Export my data' }));

    expect(await screen.findByText("Sharing isn't available on this device, so the export can't be saved.")).toBeTruthy();
    expect(mockedExportData).not.toHaveBeenCalled();
    expect(mockedShare).not.toHaveBeenCalled();
  });

  test('a file that cannot be written shows the export message and opens no share sheet', async () => {
    mockedExportData.mockResolvedValue({ ok: true, result: EXPORT });
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    await openProfile();

    await fireEvent.press(screen.getByRole('button', { name: 'Export my data' }));

    expect(await screen.findByText("Couldn't export your data. Check your internet and try again.")).toBeTruthy();
    expect(mockedShare).not.toHaveBeenCalled();
  });

  test('a failed export shows a message and opens no share sheet', async () => {
    mockedExportData.mockResolvedValue({ ok: false, error: 'network' });
    await openProfile();

    await fireEvent.press(screen.getByRole('button', { name: 'Export my data' }));

    expect(await screen.findByText("Couldn't export your data. Check your internet and try again.")).toBeTruthy();
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockedShare).not.toHaveBeenCalled();
  });

  test('a share-sheet error shows the same message', async () => {
    mockedExportData.mockResolvedValue({ ok: true, result: EXPORT });
    mockedShare.mockRejectedValueOnce(new Error('share failed'));
    await openProfile();

    await fireEvent.press(screen.getByRole('button', { name: 'Export my data' }));

    expect(await screen.findByText("Couldn't export your data. Check your internet and try again.")).toBeTruthy();
  });
});

describe('Delete account', () => {
  async function confirmBoth(): Promise<void> {
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]?.[0]).toBe('Delete your account?');
    await pressAlertButton(0, 'Continue');
    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(alertButtons(1).find((button) => button.text === 'Delete forever')?.style).toBe('destructive');
    await pressAlertButton(1, 'Delete forever');
  }

  test('cancelling the first confirm does nothing', async () => {
    await openProfile();

    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    await pressAlertButton(0, 'Cancel');

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(mockQueue.pause).not.toHaveBeenCalled();
    expect(mockedDeleteAccount).not.toHaveBeenCalled();
  });

  test('cancelling the second confirm does nothing', async () => {
    await openProfile();

    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    await pressAlertButton(0, 'Continue');
    await pressAlertButton(1, 'Cancel');

    expect(mockQueue.pause).not.toHaveBeenCalled();
    expect(mockedDeleteAccount).not.toHaveBeenCalled();
    expect(mockedSignOutLocally).not.toHaveBeenCalled();
  });

  test('a deletion pauses the upload queue first, then clears it and the device and signs out locally', async () => {
    mockedDeleteAccount.mockResolvedValue({ ok: true });
    await openProfile();

    await confirmBoth();

    await waitFor(() => {
      expect(mockedSignOutLocally).toHaveBeenCalledTimes(1);
    });
    const paused = mockQueue.pause.mock.invocationCallOrder[0] ?? Infinity;
    const deleted = mockedDeleteAccount.mock.invocationCallOrder[0] ?? -Infinity;
    expect(paused).toBeLessThan(deleted);
    // The queued photos are dropped only once the account is gone.
    expect(mockQueue.clear.mock.invocationCallOrder[0]).toBeGreaterThan(deleted);
    for (const key of USER_KEYS) {
      expect(kvGet(key)).toBeNull();
    }
    expect(kvGet(`account.deleting.${USER_ID}`)).toBeNull();
    expect(jest.mocked(signOut)).not.toHaveBeenCalled();
    // Unpaused (without a run) only once the account is gone, so a later sign-in isn't paused.
    const signedOut = mockedSignOutLocally.mock.invocationCallOrder[0] ?? Infinity;
    expect(mockQueue.resume.mock.invocationCallOrder[0]).toBeGreaterThan(signedOut);
    expect(mockQueue.resume).toHaveBeenCalledWith({ run: false });
  });

  test('an unconfirmed deletion keeps the session, the queued photos, the data and the marker, and can be retried', async () => {
    mockedDeleteAccount.mockResolvedValueOnce({ ok: false, error: 'network' });
    await openProfile();

    await confirmBoth();

    expect(
      await screen.findByText(
        "Couldn't confirm your account was deleted. Check your internet and try again. Photo uploads are paused until then.",
      ),
    ).toBeTruthy();
    expect(mockedSignOutLocally).not.toHaveBeenCalled();
    expect(mockQueue.pause).toHaveBeenCalledTimes(1);
    expect(mockQueue.clear).not.toHaveBeenCalled();
    expect(mockQueue.resume).toHaveBeenCalledTimes(1);
    expect(mockQueue.resume).toHaveBeenCalledWith({ run: false });
    for (const key of USER_KEYS) {
      expect(kvGet(key)).toBe('x');
    }
    // The server may have finished: the marker stays, so the queue stays blocked until a tap or launch check.
    expect(deletionState(USER_ID)).toBe('deleting');

    mockedDeleteAccount.mockResolvedValueOnce({ ok: true });
    await confirmBothAgain();

    await waitFor(() => {
      expect(mockedSignOutLocally).toHaveBeenCalledTimes(1);
    });
    expect(mockedDeleteAccount).toHaveBeenCalledTimes(2);
  });

  test('reauth asks to sign in again, signs out locally and keeps the queued photos and the data', async () => {
    mockedDeleteAccount.mockResolvedValue({ ok: false, error: 'reauth' });
    await openProfile();

    await confirmBoth();

    await waitFor(() => {
      expect(mockedSignOutLocally).toHaveBeenCalledTimes(1);
    });
    expect(alertSpy).toHaveBeenLastCalledWith('Sign in again, then delete your account again to finish.');
    expect(alertSpy).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/was deleted/i)).toBeNull();
    expect(mockQueue.clear).not.toHaveBeenCalled();
    expect(mockQueue.resume).toHaveBeenCalledWith({ run: false });
    expect(deletionState(USER_ID)).toBe('reauth');
    for (const key of USER_KEYS) {
      expect(kvGet(key)).toBe('x');
    }
  });

  test('pressing "Delete forever" twice deletes once', async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    mockedDeleteAccount.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await openProfile();

    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    await pressAlertButton(0, 'Continue');
    await pressAlertButton(1, 'Delete forever');
    await pressAlertButton(1, 'Delete forever');
    await act(async () => {
      finish({ ok: true });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockedSignOutLocally).toHaveBeenCalledTimes(1);
    });
    expect(mockedDeleteAccount).toHaveBeenCalledTimes(1);
  });

  test('while the delete confirms are open, a second Delete or an Export does nothing until Cancel', async () => {
    mockedExportData.mockResolvedValue({ ok: true, result: EXPORT });
    await openProfile();

    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Export my data' }));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(mockedExportData).not.toHaveBeenCalled();

    await pressAlertButton(0, 'Cancel');
    await fireEvent.press(screen.getByRole('button', { name: 'Export my data' }));

    await waitFor(() => {
      expect(mockedShare).toHaveBeenCalledTimes(1);
    });
  });

  async function confirmBothAgain(): Promise<void> {
    const shown = alertSpy.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    await pressAlertButton(shown, 'Continue');
    await pressAlertButton(shown + 1, 'Delete forever');
  }
});
