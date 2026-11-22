// Mounted while signed in and onboarded: a tap on a server notice opens its screen. The route comes
// from the notice's kind, never from its `data.url`, so a notice can only open these two screens.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

const ROUTES = { reviewReady: '/review', weeklySummary: '/closet?segment=stats' } as const;

function routeOf(response: Notifications.NotificationResponse): (typeof ROUTES)[keyof typeof ROUTES] | null {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const kind = response.notification.request.content.data?.kind;
  if (kind === 'reviewReady') return ROUTES.reviewReady;
  if (kind === 'weeklySummary') return ROUTES.weeklySummary;
  return null;
}

export function PushTapSync(): null {
  useEffect(() => {
    function open(response: Notifications.NotificationResponse | null): void {
      const route = response === null ? null : routeOf(response);
      if (route === null) return;
      // Cleared so a later remount (another sign-in) doesn't follow the same tap again.
      Notifications.clearLastNotificationResponse();
      router.navigate(route);
    }
    // A tap that launched the app arrived before this listener existed.
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      subscription.remove();
    };
  }, []);

  return null;
}
