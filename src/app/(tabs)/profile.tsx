import { useIsFocused } from 'expo-router';
import { Check, Download, Eye, LogOut, Trash2, Users } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePrivacyActions } from '../../account/usePrivacyActions';
import { useAuth } from '../../auth/AuthProvider';
import { clearLanguageSavePending, markLanguageSavePending } from '../../auth/deviceState';
import { useSignOut } from '../../auth/useSignOut';
import type { MessageKey } from '../../i18n';
import { pluralKey, useI18n } from '../../i18n';
import { useLocalePreference } from '../../i18n/I18nProvider';
import { changedFields, draftFromProfile, draftToPatch } from '../../profile/profileDraft';
import type { BodyErrors, ProfileDraft } from '../../profile/profileDraft';
import { BodySection, ClothingSection, StyleSection } from '../../profile/ProfileForm';
import { saveProfile } from '../../profile/profileRepository';
import type { ProfilePatch, Result } from '../../profile/profileRepository';
import type { BodyField } from '../../profile/validation';
import { announceForAccessibility } from '../../ui/a11y';
import { ActionNotice } from '../../ui/ActionNotice';
import { Screen } from '../../ui/Screen';
import { colors, fontSizes, layout, radii, spacing } from '../../ui/theme';
import { LanguageToggle } from '../../ui/LanguageToggle';
import type { RequestError } from '../../lib/requestResult';
import { clearDismissed } from '../../outfits/storedDismissed';
import { countDismissed, restoreDismissed } from '../../outfits/suggestionFeedback';
import { ReminderSection } from '../../reminder/ReminderSection';

/** How long "Saved" stays on the button after a save. */
export const SAVED_NOTE_MS = 2000;

function SectionHeading({ children }: { children: string }): React.JSX.Element {
  return (
    <Text style={styles.heading} accessibilityRole="header" accessibilityLabel={children}>
      {children.toUpperCase()}
    </Text>
  );
}

/** Sign out waits while an export or deletion runs, so a late answer can't land on the next account. */
function AccountSection({ privacyBusy }: { privacyBusy: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const { email } = useAuth();
  const signOut = useSignOut();
  const disabled = signOut.signingOut || privacyBusy;
  return (
    <>
      <SectionHeading>{t('profile.section.account')}</SectionHeading>
      <View style={styles.card}>
        {email !== null ? (
          <View style={styles.account}>
            <Text style={styles.muted}>{t('profile.account.signedInAs')}</Text>
            <Text style={styles.email} numberOfLines={1}>
              {email}
            </Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: signOut.signingOut }}
          disabled={disabled}
          onPress={signOut.signOut}
          style={[styles.signOut, disabled ? styles.disabled : null]}
        >
          <LogOut size={16} color={colors.ink} />
          <Text style={styles.signOutLabel}>{t('auth.signOut')}</Text>
        </Pressable>
        {signOut.error !== undefined ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {t(signOut.error)}
          </Text>
        ) : null}
      </View>
    </>
  );
}

/** Export (a JSON file via the share sheet) and Delete account (two confirms); both disabled while either runs. */
function PrivacySection({ exporting, deleting }: ReturnType<typeof usePrivacyActions>): React.JSX.Element {
  const { t } = useI18n();
  const busy = exporting.busy || deleting.busy;
  return (
    <>
      <SectionHeading>{t('profile.section.privacy')}</SectionHeading>
      <View style={styles.card}>
        <Text style={styles.privacyNote}>{t('profile.privacy.note')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.privacy.export')}
          accessibilityState={{ disabled: busy, busy: exporting.busy }}
          disabled={busy}
          onPress={exporting.run}
          style={[styles.signOut, busy ? styles.disabled : null]}
        >
          {exporting.busy ? <ActivityIndicator size="small" color={colors.ink} /> : <Download size={16} color={colors.ink} />}
          <Text style={styles.signOutLabel}>{exporting.busy ? t('profile.privacy.exporting') : t('profile.privacy.export')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.privacy.delete')}
          accessibilityState={{ disabled: busy, busy: deleting.busy }}
          disabled={busy}
          onPress={deleting.run}
          style={[styles.signOut, styles.danger, busy ? styles.disabled : null]}
        >
          {deleting.busy ? <ActivityIndicator size="small" color={colors.error} /> : <Trash2 size={16} color={colors.error} />}
          <Text style={[styles.signOutLabel, styles.dangerLabel]}>
            {deleting.busy ? t('profile.privacy.deleting') : t('profile.privacy.delete')}
          </Text>
        </Pressable>
        {[exporting.error, deleting.error].map((error) =>
          error !== undefined ? (
            <Text key={error} style={styles.error} accessibilityLiveRegion="polite">
              {t(error)}
            </Text>
          ) : null,
        )}
      </View>
    </>
  );
}

/** Today's "Not for me" combinations, counted on focus and restored all at once after a confirm. */
function HiddenSuggestionsSection(): React.JSX.Element {
  const { t } = useI18n();
  const { userId } = useAuth();
  const focused = useIsFocused();
  const [count, setCount] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<RequestError | null>(null);

  useEffect(() => {
    if (!focused) return undefined;
    let current = true;
    void countDismissed().then((value) => {
      if (current && value !== null) setCount(value);
    });
    return () => {
      current = false;
    };
  }, [focused]);

  const restore = useCallback(async () => {
    if (userId === null) return;
    setRestoring(true);
    setError(null);
    const result = await restoreDismissed(userId);
    setRestoring(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    clearDismissed(userId);
    setCount(0);
    announceForAccessibility(t('profile.hidden.restored'));
  }, [userId, t]);

  const confirm = useCallback(() => {
    if (count === null || count === 0) return;
    Alert.alert(t(pluralKey('profile.hidden.confirmTitle', count), { count }), t('profile.hidden.confirmMessage'), [
      { text: t('profile.hidden.cancel'), style: 'cancel' },
      {
        text: t('profile.hidden.restore'),
        onPress: () => {
          void restore();
        },
      },
    ]);
  }, [count, restore, t]);

  const disabled = restoring || count === null || count === 0;
  const label = t('profile.hidden.action');
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy: restoring }}
        disabled={disabled}
        onPress={confirm}
        style={[styles.signOut, disabled ? styles.disabled : null]}
      >
        {restoring ? <ActivityIndicator size="small" color={colors.ink} /> : <Eye size={16} color={colors.ink} />}
        <Text style={styles.signOutLabel}>{label}</Text>
      </Pressable>
      {count === null ? null : (
        <Text style={[styles.muted, styles.hiddenCount]}>
          {count === 0 ? t('profile.hidden.none') : t(pluralKey('profile.hidden.count', count), { count })}
        </Text>
      )}
      {error === null ? null : (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {t(`profile.hidden.error.${error}`)}
        </Text>
      )}
    </View>
  );
}

/** A preview of a later feature: one row, not a control. */
function HouseholdSection(): React.JSX.Element {
  const { t } = useI18n();
  const title = t('profile.household.title');
  const soon = t('profile.household.soon');
  const body = t('profile.household.body');
  return (
    <View style={styles.card} accessible accessibilityLabel={`${title}, ${soon.toLocaleLowerCase()}. ${body}`}>
      <View style={styles.household}>
        <Users size={18} color={colors.muted} />
        <View style={styles.householdText}>
          <View style={styles.householdHead}>
            <Text style={styles.rowLabel}>{title}</Text>
            <Text style={styles.soon}>{soon}</Text>
          </View>
          <Text style={styles.muted}>{body}</Text>
        </View>
      </View>
    </View>
  );
}

/** Account and Privacy share the Privacy actions' busy state. */
function AccountAndPrivacy(): React.JSX.Element {
  const privacy = usePrivacyActions();
  return (
    <>
      <AccountSection privacyBusy={privacy.exporting.busy || privacy.deleting.busy} />
      <PrivacySection {...privacy} />
      <HiddenSuggestionsSection />
    </>
  );
}

/**
 * A change applies at once and saves to `profile.language` on its own, outside the Save button.
 * `AuthProvider` applies `profile.language` on sign-in and retries a failed save there.
 */
function LanguageSection({ onSave }: { onSave: (language: 'en' | 'es' | null) => Promise<MessageKey | undefined> }) {
  const { t, locale } = useI18n();
  const { preference, setPreference } = useLocalePreference();
  const [error, setError] = useState<MessageKey | undefined>(undefined);
  const followsDevice = preference === 'system';

  function save(language: 'en' | 'es' | null): void {
    setError(undefined);
    void onSave(language).then(setError);
  }

  return (
    <>
      <SectionHeading>{t('profile.section.language')}</SectionHeading>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.language.app')}</Text>
          <LanguageToggle onChange={save} />
        </View>
        <View style={styles.divider} />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: followsDevice }}
          accessibilityLabel={t('profile.language.device')}
          onPress={() => {
            // Unchecking keeps the language currently shown, now as an explicit choice.
            const next = followsDevice ? locale : 'system';
            setPreference(next);
            save(next === 'system' ? null : next);
          }}
          style={styles.row}
          testID="profile-device-language"
        >
          <Text style={styles.rowLabel}>{t('profile.language.device')}</Text>
          <View style={[styles.checkbox, followsDevice ? styles.checkboxOn : null]}>
            {followsDevice ? <Check size={14} color={colors.onFill} strokeWidth={3} /> : null}
          </View>
        </Pressable>
        {error !== undefined ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {t(error)}
          </Text>
        ) : null}
      </View>
    </>
  );
}

function ProfileEditor({ userId, initial }: { userId: string; initial: ProfilePatch }): React.JSX.Element {
  const { t } = useI18n();
  const { replaceProfileLocal } = useAuth();
  const [saved, setSaved] = useState<ProfilePatch>(initial);
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(initial));
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<MessageKey | undefined>(undefined);
  // Errors show once a field is left or on a save attempt, then update live so a fix clears them.
  const [touched, setTouched] = useState<ReadonlySet<BodyField>>(new Set());
  const [showAllErrors, setShowAllErrors] = useState(false);
  // Language saves run in order (the server ends with the last choice); only the latest one reports.
  const languageQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const languageSeqRef = useRef(0);

  const validation = draftToPatch(draft);
  const changes = validation.ok ? changedFields(saved, validation.patch) : {};
  const dirty = Object.keys(changes).length > 0;
  const visibleErrors: BodyErrors = validation.ok
    ? {}
    : Object.fromEntries(
        Object.entries(validation.errors).filter(([field]) => showAllErrors || touched.has(field as BodyField)),
      );

  useEffect(() => {
    if (!justSaved) return undefined;
    const timer = setTimeout(() => {
      setJustSaved(false);
    }, SAVED_NOTE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [justSaved]);

  function edit(patch: Partial<ProfileDraft>): void {
    setDraft((previous) => ({ ...previous, ...patch }));
    setJustSaved(false);
    setSaveError(undefined);
  }

  async function handleSave(): Promise<void> {
    if (!validation.ok) {
      // Save stays tappable while invalid so it can say why: every error shows, the first announced.
      setShowAllErrors(true);
      const first = Object.values(validation.errors)[0];
      if (first !== undefined) {
        announceForAccessibility(t(first.key, first.params));
      }
      return;
    }
    if (!dirty) {
      return;
    }
    const draftAtSave = draft;
    setSaveError(undefined);
    setSaving(true);
    const result = await saveProfile(userId, changes);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      announceForAccessibility(t(result.error));
      return;
    }
    const next = { ...saved, ...changes };
    setSaved(next);
    replaceProfileLocal(changes);
    // Show the saved (normalized) values, e.g. a trimmed size, unless the user kept editing.
    setDraft((current) => (current === draftAtSave ? draftFromProfile(next) : current));
    setTouched(new Set());
    setShowAllErrors(false);
    setJustSaved(true);
    announceForAccessibility(t('profile.saved'));
  }

  async function saveLanguage(language: 'en' | 'es' | null): Promise<MessageKey | undefined> {
    languageSeqRef.current += 1;
    const seq = languageSeqRef.current;
    const request: Promise<Result> = languageQueueRef.current.then(() => saveProfile(userId, { language }));
    languageQueueRef.current = request;
    const result = await request;
    if (seq !== languageSeqRef.current) {
      return undefined;
    }
    if (!result.ok) {
      // AuthProvider retries the save on the next profile load instead of applying the server's older value.
      markLanguageSavePending(userId);
      announceForAccessibility(t(result.error));
      return result.error;
    }
    clearLanguageSavePending(userId);
    setSaved((previous) => ({ ...previous, language }));
    replaceProfileLocal({ language });
    return undefined;
  }

  // Only while there's something to save, saving, or to report: an invalid draft keeps it so Save can say why.
  const showSave = dirty || !validation.ok || saving || saveError !== undefined || justSaved;
  return (
    <Screen
      title={t('screen.profile')}
      {...(showSave
        ? {
            cta: {
              primary: {
                label: justSaved && !dirty ? t('profile.saved') : t('profile.save'),
                tone: 'commit' as const,
                disabled: saving || (validation.ok && !dirty),
                onPress: () => {
                  void handleSave();
                },
              },
              ...(saveError === undefined ? {} : { notice: <ActionNotice tone="error">{t(saveError)}</ActionNotice> }),
            },
          }
        : {})}
    >
      <View style={styles.form} testID="profile-form">
        <SectionHeading>{t('profile.section.clothes')}</SectionHeading>
        <ClothingSection value={draft} onChange={edit} />
        <SectionHeading>{t('profile.section.body')}</SectionHeading>
        <BodySection
          value={draft}
          onChange={edit}
          unsetHeight="notSet"
          errors={visibleErrors}
          onFieldBlur={(field) => {
            setTouched((previous) => new Set(previous).add(field));
          }}
        />
        <SectionHeading>{t('profile.section.style')}</SectionHeading>
        <StyleSection value={draft} onChange={edit} />
        <SectionHeading>{t('profile.section.reminder')}</SectionHeading>
        <ReminderSection userId={userId} />
        <LanguageSection onSave={saveLanguage} />
        <SectionHeading>{t('profile.section.household')}</SectionHeading>
        <HouseholdSection />
        <AccountAndPrivacy />
        {saveError === undefined ? null : <View style={styles.noticeRoom} />}
      </View>
    </Screen>
  );
}

export default function ProfileScreen() {
  const { t } = useI18n();
  const { userId, profile, profileStatus, refreshProfile } = useAuth();

  if (profileStatus === 'ready' && profile !== null && userId !== null) {
    return <ProfileEditor key={userId} userId={userId} initial={profile} />;
  }

  // Without the saved profile the form would show defaults (saving them would overwrite real data),
  // so a failed read offers a retry; Sign out stays reachable either way.
  return (
    <Screen
      title={t('screen.profile')}
      {...(profileStatus === 'error'
        ? {
            cta: {
              primary: {
                label: t('onboarding.retry'),
                tone: 'commit' as const,
                onPress: () => {
                  void refreshProfile();
                },
              },
            },
          }
        : {})}
    >
      {profileStatus === 'error' ? (
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {t('onboarding.loadError')}
        </Text>
      ) : (
        <ActivityIndicator style={styles.spinner} color={colors.accent} accessibilityLabel={t('onboarding.loading')} />
      )}
      <AccountAndPrivacy />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.sm,
  },
  heading: {
    marginTop: spacing.md,
    color: colors.ink,
    fontSize: fontSizes.bodySmall,
    fontWeight: '900',
    letterSpacing: 1,
  },
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
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.dashed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  account: {
    paddingTop: 8,
    paddingBottom: 4,
    gap: 2,
  },
  muted: {
    color: colors.muted,
    fontSize: fontSizes.caption,
  },
  hiddenCount: {
    textAlign: 'center',
    paddingBottom: 6,
  },
  household: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  householdText: {
    flex: 1,
    gap: 2,
  },
  householdHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  soon: {
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.tint,
    color: colors.accentText,
    fontSize: fontSizes.caption,
    fontWeight: '700',
  },
  noticeRoom: {
    height: 56,
  },
  email: {
    color: colors.ink,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: layout.minHitTarget,
    marginVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  signOutLabel: {
    color: colors.ink,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  privacyNote: {
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
    lineHeight: 18,
    paddingTop: 8,
  },
  danger: {
    marginTop: 0,
    borderColor: colors.errorTint,
    backgroundColor: colors.errorTint,
  },
  dangerLabel: {
    color: colors.error,
  },
  message: {
    color: colors.ink,
    fontSize: fontSizes.body,
  },
  spinner: {
    marginVertical: spacing.lg,
  },
  error: {
    color: colors.error,
    fontSize: fontSizes.bodySmall,
    fontWeight: '600',
    paddingBottom: 6,
  },
});
