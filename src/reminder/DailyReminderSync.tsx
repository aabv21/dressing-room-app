// Mounted while signed in and onboarded: a tap on the reminder opens Today, and an enabled reminder
// is re-scheduled when the language or the coming plans changed, or the OS no longer holds it.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useCloset } from '../closet/ClosetProvider';
import { useI18n } from '../i18n';
import { useOnResume } from '../lib/useOnResume';
import { orderPieces, pieceLabel } from '../outfits/outfitDisplay';
import { usePlans } from '../planner/planCache';
import { isReminderCurrent, isReminderResponse, scheduleReminder, setReminderPlans } from './dailyReminder';
import { readReminder } from './reminderStore';

export function DailyReminderSync(): null {
  const { userId } = useAuth();
  const { locale, t } = useI18n();
  const { garments } = useCloset();
  const plans = usePlans(userId);
  // Bumped on returning to the foreground: a day may have passed, so the coming week's texts differ.
  const [resumed, setResumed] = useState(0);
  useOnResume(() => {
    setResumed((count) => count + 1);
  });

  // Each planned day's pieces still in the closet, as the reminder names them.
  const plannedText = useMemo((): Record<string, string> => {
    const byId = new Map(garments.map((garment) => [garment.id, garment]));
    return Object.fromEntries(
      plans.flatMap((plan): [string, string][] => {
        const pieces = orderPieces(plan.garmentIds.flatMap((id) => byId.get(id) ?? []));
        return pieces.length === 0 ? [] : [[plan.day, pieces.map((piece) => pieceLabel(piece, t)).join(', ')]];
      }),
    );
  }, [plans, garments, t]);
  // The text decides a re-check, not the object: a closet refresh rebuilds it with the same text.
  const plannedKey = JSON.stringify(plannedText);
  const latestText = useRef(plannedText);
  useEffect(() => {
    latestText.current = plannedText;
  });

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
    setReminderPlans(userId, latestText.current);
    const settings = readReminder(userId);
    if (!settings.enabled) return undefined;
    const run = { live: true };
    const time = { hour: settings.hour, minute: settings.minute };
    void (async () => {
      // A restored backup or an OS purge keeps the kv's "on" but drops the notification itself.
      if (settings.language === locale && (await isReminderCurrent(userId, time, locale))) return;
      if (run.live) void scheduleReminder(userId, time, locale);
    })();
    return () => {
      run.live = false;
    };
  }, [userId, locale, plannedKey, resumed]);

  return null;
}
