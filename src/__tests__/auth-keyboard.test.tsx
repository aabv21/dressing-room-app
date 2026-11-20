// The auth screens wrap `Screen`, which avoids the keyboard itself on Android (`padding`); a
// second avoiding view around it double-counts the keyboard. This file records the behavior of
// every KeyboardAvoidingView rendered, through a partial mock of react-native.
import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';

const mockBehaviors: unknown[] = [];

jest.mock('react-native', () => {
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  const React = jest.requireActual<typeof import('react')>('react');
  const Real = RN.KeyboardAvoidingView;
  function RecordingKeyboardAvoidingView(props: React.ComponentProps<typeof Real>): React.JSX.Element {
    mockBehaviors.push(props.behavior);
    return React.createElement(Real, props);
  }
  return new Proxy(RN, {
    get: (target, key, receiver) =>
      key === 'KeyboardAvoidingView' ? RecordingKeyboardAvoidingView : (Reflect.get(target, key, receiver) as unknown),
  });
});

jest.mock('../auth/authService', () => ({
  signUpWithEmail: jest.fn(),
  signInWithEmail: jest.fn(),
  requestPasswordReset: jest.fn(),
  confirmPasswordReset: jest.fn(),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  signOut: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
}));

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 2 },
}));

import ForgotPasswordScreen from '../app/(auth)/forgot-password';
import SignInScreen from '../app/(auth)/sign-in';
import WelcomeScreen from '../app/(auth)/welcome';

const originalOS = Platform.OS;
afterEach(() => {
  Platform.OS = originalOS;
});

test.each([
  ['Welcome', () => <WelcomeScreen />],
  ['Sign in', () => <SignInScreen />],
  ['Forgot password', () => <ForgotPasswordScreen />],
])('%s avoids the keyboard once on Android: only Screen sets a behavior', async (_name, ui) => {
  Platform.OS = 'android';
  mockBehaviors.length = 0;
  await render(ui());
  expect(mockBehaviors.length).toBeGreaterThan(0);
  expect([...new Set(mockBehaviors.filter((behavior) => behavior !== undefined))]).toEqual(['padding']);
});
