// Mounted while signed in and onboarded: resumes a pending token reclaim, and confirms it when its
// code arrives as a data-only push (docs/app.md#notifications-from-the-app-srcpush).
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { confirmPushClaim, resumePushClaim } from './pushRegistration';

// NOTE: the code is read only while the app runs (foreground); upgrade: a background notification task, if claims stall.
export function PushClaimSync({ userId }: { userId: string }): null {
  useEffect(() => {
    void resumePushClaim(userId);
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (data?.type !== 'push-claim' || typeof data.code !== 'string' || typeof data.nonce !== 'string') return;
      void confirmPushClaim(data.code, data.nonce, userId);
    });
    return () => {
      subscription.remove();
    };
  }, [userId]);

  return null;
}
