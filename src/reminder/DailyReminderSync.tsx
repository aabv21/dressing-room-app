// Mounted while signed in and onboarded: a tap on the reminder opens Today, and a language change
// re-schedules the reminder's copy in the new language.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { isReminderResponse, scheduleReminder } from './dailyReminder';
import { readReminder } from './reminderStore';

export function DailyReminderSync(): null {
  const { userId } = useAuth();
  const { locale } = useI18n();

  useEffect(() => {
    function open(response: Notifications.NotificationResponse | null): void {
      if (response === null || !isReminderResponse(response)) return;
      // Cleared so a later remount (another sign-in) doesn't follow the same tap again.
      Notifications.clearLastNotificationResponse();
      router.navigate('/');
    }
    // A tap that launched the app arrived before this listener existed.
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (userId === null) return;
    const settings = readReminder(userId);
    if (settings.enabled && settings.language !== locale) {
      void scheduleReminder(userId, { hour: settings.hour, minute: settings.minute }, locale);
    }
  }, [userId, locale]);

  return null;
}
