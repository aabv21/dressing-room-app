import { Redirect } from 'expo-router';

// The (auth) group's screens are named for their purpose (welcome, sign-in, forgot-password), so
// none of them is literally `index` — Expo Router needs a route that matches the
// group's own root path ("/") to avoid an Unmatched Route when `Stack.Protected` activates this
// group, so this redirects there to the group's entry screen.
export default function AuthIndexRedirect() {
  return <Redirect href="/welcome" />;
}
