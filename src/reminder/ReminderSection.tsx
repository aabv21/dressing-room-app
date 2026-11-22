// Profile's "Daily reminder": a switch and a time; the settings stay on this device
// (docs/app.md#the-daily-reminder-srcreminder).
import { ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { useI18n, type Locale } from '../i18n';
import { announceForAccessibility } from '../ui/a11y';
import { BottomSheet } from '../ui/BottomSheet';
import { ChipGroup } from '../ui/ChipGroup';
import { OpenSettingsLink } from '../ui/OpenSettingsLink';
import { colors, fontSizes, layout, radii, spacing } from '../ui/theme';
import { scheduleReminder, turnOffReminder, turnOnReminder } from './dailyReminder';
import { useReminderSettings, writeReminder, type ReminderTime } from './reminderStore';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 12 }, (_, step) => step * 5);

/** "7:30 AM" / "7:30 a. m.", in the app's language. */
export function formatReminderTime(time: ReminderTime, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(2000, 0, 1, time.hour, time.minute),
  );
}

function hourLabel(hour: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour));
}

/** Mounted only while open, so each opening starts from the saved time. */
function ReminderTimeSheet({
  value,
  onDone,
  onClose,
}: {
  value: ReminderTime;
  onDone: (time: ReminderTime) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState(value);
  return (
    <BottomSheet visible title={t('reminder.sheet.title')} subtitle={formatReminderTime(draft, locale)} onClose={onClose} testID="reminder-time-sheet">
      <Text style={styles.sheetLabel}>{t('reminder.sheet.hour')}</Text>
      <ChipGroup
        multiple={false}
        accessibilityLabel={t('reminder.sheet.hour')}
        options={HOURS.map((hour) => ({ value: String(hour), label: hourLabel(hour, locale) }))}
        selected={[String(draft.hour)]}
        onChange={([next]) => {
          // Tapping the chosen chip would clear it; a time always has an hour.
          if (next !== undefined) setDraft((current) => ({ ...current, hour: Number(next) }));
        }}
      />
      <Text style={styles.sheetLabel}>{t('reminder.sheet.minute')}</Text>
      <ChipGroup
        multiple={false}
        accessibilityLabel={t('reminder.sheet.minute')}
        options={MINUTES.map((minute) => ({ value: String(minute), label: `:${String(minute).padStart(2, '0')}` }))}
        selected={[String(draft.minute)]}
        onChange={([next]) => {
          if (next !== undefined) setDraft((current) => ({ ...current, minute: Number(next) }));
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('reminder.sheet.done')}
        onPress={() => {
          onDone(draft);
        }}
        style={({ pressed }) => [styles.done, pressed ? styles.pressed : null]}
      >
        <Text style={styles.doneLabel}>{t('reminder.sheet.done')}</Text>
      </Pressable>
    </BottomSheet>
  );
}

export function ReminderSection({ userId }: { userId: string }): React.JSX.Element {
  const { t, locale } = useI18n();
  const settings = useReminderSettings(userId);
  // The switch shows the requested state while the permission prompt or scheduling runs.
  const [pending, setPending] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<'denied' | 'failed' | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const time = { hour: settings.hour, minute: settings.minute };
  const timeText = formatReminderTime(time, locale);

  function report(next: 'denied' | 'failed' | null, announcement: string): void {
    setProblem(next);
    announceForAccessibility(announcement);
  }

  async function toggle(next: boolean): Promise<void> {
    setProblem(null);
    setPending(next);
    if (!next) {
      await turnOffReminder(userId);
      setPending(null);
      report(null, t('reminder.off'));
      return;
    }
    const outcome = await turnOnReminder(userId, time, locale);
    setPending(null);
    if (outcome === 'on') report(null, t('reminder.on', { time: timeText }));
    else report(outcome, t(outcome === 'denied' ? 'reminder.denied' : 'reminder.failed'));
  }

  async function changeTime(next: ReminderTime): Promise<void> {
    setSheetOpen(false);
    if (next.hour === settings.hour && next.minute === settings.minute) return;
    setProblem(null);
    if (!settings.enabled) {
      // Kept for when the switch goes on.
      writeReminder(userId, { ...settings, ...next });
      return;
    }
    setPending(true);
    const ok = await scheduleReminder(userId, next, locale);
    setPending(null);
    const nextText = formatReminderTime(next, locale);
    if (ok) report(null, t('reminder.on', { time: nextText }));
    else report('failed', t('reminder.failed'));
  }

  const busy = pending !== null;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t('reminder.switch')}</Text>
        <Switch
          accessibilityLabel={t('reminder.switch')}
          accessibilityHint={t('reminder.switch.hint')}
          value={pending ?? settings.enabled}
          disabled={busy}
          trackColor={{ true: colors.accent, false: colors.track }}
          onValueChange={(next) => {
            void toggle(next);
          }}
        />
      </View>
      <View style={styles.divider} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('reminder.time')}, ${timeText}`}
        accessibilityHint={t('reminder.time.hint')}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => {
          setSheetOpen(true);
        }}
        style={styles.row}
      >
        <Text style={styles.rowLabel}>{t('reminder.time')}</Text>
        <Text style={styles.value}>{timeText}</Text>
        <ChevronRight size={16} color={colors.muted} />
      </Pressable>
      {problem === null ? null : (
        <View style={styles.problem} accessibilityLiveRegion="polite">
          <Text style={styles.error}>{t(problem === 'denied' ? 'reminder.denied' : 'reminder.failed')}</Text>
          {problem === 'denied' ? <OpenSettingsLink /> : null}
        </View>
      )}
      {sheetOpen ? (
        <ReminderTimeSheet
          value={time}
          onDone={(next) => {
            void changeTime(next);
          }}
          onClose={() => {
            setSheetOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: layout.minHitTarget + 8,
  },
  rowLabel: {
    flex: 1,
    color: colors.ink,
    fontSize: fontSizes.body,
  },
  value: {
    color: colors.accentText,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
  },
  problem: {
    paddingBottom: 6,
  },
  error: {
    color: colors.error,
    fontSize: fontSizes.bodySmall,
    fontWeight: '600',
  },
  sheetLabel: {
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
  done: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.commit,
  },
  pressed: {
    opacity: 0.85,
  },
  doneLabel: {
    color: colors.onFill,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
});
