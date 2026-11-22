// Mounted while signed in and onboarded: a tap on the reminder opens Today, and an enabled reminder
// is re-scheduled when the language changed or the OS no longer holds it.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { isReminderResponse, isReminderScheduled, scheduleReminder } from './dailyReminder';
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
    if (userId === null) return undefined;
    const settings = readReminder(userId);
    if (!settings.enabled) return undefined;
    const run = { live: true };
    void (async () => {
      // A restored backup or an OS purge keeps the kv's "on" but drops the notification itself.
      if (settings.language === locale && (await isReminderScheduled())) return;
      if (run.live) void scheduleReminder(userId, { hour: settings.hour, minute: settings.minute }, locale);
    })();
    return () => {
      run.live = false;
    };
  }, [userId, locale]);

  return null;
}
