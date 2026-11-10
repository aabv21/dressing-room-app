import { router } from 'expo-router';

/**
 * Back where the user came from. A deep link opens a closet screen (a garment's detail, the review
 * queue) with no history and no tab bar, so then it lands on the closet instead.
 */
export function leaveToCloset(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/closet');
  }
}
