import { Check, LogOut } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { clearLanguageSavePending, markLanguageSavePending } from '../../auth/deviceState';
import { useSignOut } from '../../auth/useSignOut';
import type { MessageKey } from '../../i18n';
import { useI18n } from '../../i18n';
import { useLocalePreference } from '../../i18n/I18nProvider';
import { changedFields, draftFromProfile, draftToPatch } from '../../profile/profileDraft';
import type { BodyErrors, ProfileDraft } from '../../profile/profileDraft';
import { BodySection, ClothingSection, StyleSection } from '../../profile/ProfileForm';
import { getProfile, saveProfile } from '../../profile/profileRepository';
import type { ProfilePatch, Result } from '../../profile/profileRepository';
import type { BodyField } from '../../profile/validation';
import { announceForAccessibility } from '../../ui/a11y';
import { Screen } from '../../ui/Screen';
import { colors, layout, radii, spacing } from '../../ui/theme';
import { LanguageToggle } from '../../ui/LanguageToggle';

function SectionHeading({ children }: { children: string }): React.JSX.Element {
  return (
    <Text style={styles.heading} accessibilityRole="header">
      {children.toUpperCase()}
    </Text>
  );
}

/** "Account": the signed-in email and Sign out (deletion and export arrive with Plan 5). */
function AccountSection(): React.JSX.Element {
  const { t } = useI18n();
  const { email } = useAuth();
  const signOut = useSignOut();
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
          accessibilityState={{ disabled: signOut.signingOut, busy: signOut.signingOut }}
          disabled={signOut.signingOut}
          onPress={signOut.signOut}
          style={[styles.signOut, signOut.signingOut ? styles.disabled : null]}
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

/**
 * "Language": the ES/EN toggle plus "Use device language". A change applies at once (the
 * I18nProvider preference) and is saved to `profile.language` on its own, outside the Save button.
 * `profile.language` is applied to the device preference on sign-in by `AuthProvider`, so this
 * section's own saves and that startup reconciliation share the same source of truth; a save that
 * fails is retried there rather than overwritten.
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
            {followsDevice ? <Check size={14} color="#ffffff" strokeWidth={3} /> : null}
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
  const [saved, setSaved] = useState<ProfilePatch>(initial);
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(initial));
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<MessageKey | undefined>(undefined);
  // Field errors show once a field is left (blur) or on a save attempt, not on every keystroke;
  // a touched field's error then updates live, so fixing it clears it at once.
  const [touched, setTouched] = useState<ReadonlySet<BodyField>>(new Set());
  const [showAllErrors, setShowAllErrors] = useState(false);
  // Language saves run one after another (so the server ends with the last choice), and only the
  // latest one's outcome is reported.
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

  function edit(patch: Partial<ProfileDraft>): void {
    setDraft((previous) => ({ ...previous, ...patch }));
    setJustSaved(false);
  }

  async function handleSave(): Promise<void> {
    if (!validation.ok) {
      // Save stays tappable while invalid so it can say why: every error shows and the first is
      // announced.
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
      // The choice already applies on this device; AuthProvider retries the save on the next
      // profile load instead of replacing it with the server's older value.
      markLanguageSavePending(userId);
      announceForAccessibility(t(result.error));
      return result.error;
    }
    clearLanguageSavePending(userId);
    setSaved((previous) => ({ ...previous, language }));
    return undefined;
  }

  return (
    <Screen
      title={t('screen.profile')}
      cta={{
        primary: {
          label: justSaved && !dirty ? t('profile.saved') : t('profile.save'),
          tone: 'commit',
          disabled: saving || (validation.ok && !dirty),
          onPress: () => {
            void handleSave();
          },
        },
      }}
    >
      <View style={styles.form} testID="profile-form">
        <SectionHeading>{t('profile.section.clothes')}</SectionHeading>
        <ClothingSection value={draft} onChange={edit} />
        <SectionHeading>{t('profile.section.body')}</SectionHeading>
        <BodySection
          value={draft}
          onChange={edit}
          errors={visibleErrors}
          onFieldBlur={(field) => {
            setTouched((previous) => new Set(previous).add(field));
          }}
        />
        <SectionHeading>{t('profile.section.style')}</SectionHeading>
        <StyleSection value={draft} onChange={edit} />
        <LanguageSection onSave={saveLanguage} />
        <AccountSection />
        {saveError !== undefined ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {t(saveError)}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; userId: string }
  | { status: 'ready'; userId: string; profile: ProfilePatch };

export default function ProfileScreen() {
  const { t } = useI18n();
  const { userId } = useAuth();
  const [stored, setLoad] = useState<LoadState>({ status: 'loading' });
  // A result only counts for the account it was read for: another sign-in shows loading, never the
  // previous account's form.
  const load: LoadState = stored.status !== 'loading' && stored.userId === userId ? stored : { status: 'loading' };
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (userId === null) {
      return undefined;
    }
    let current = true;
    getProfile(userId).then(
      (profile) => {
        if (current) {
          setLoad({ status: 'ready', userId, profile: profile ?? {} });
        }
      },
      () => {
        if (current) {
          setLoad({ status: 'error', userId });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [userId, attempt]);

  if (load.status === 'ready' && userId !== null) {
    return <ProfileEditor key={userId} userId={userId} initial={load.profile} />;
  }

  // Without the saved profile the form would show defaults (and saving them would overwrite real
  // data), so a failed read offers a retry — and Sign out stays reachable either way.
  return (
    <Screen
      title={t('screen.profile')}
      {...(load.status === 'error'
        ? {
            cta: {
              primary: {
                label: t('onboarding.retry'),
                tone: 'commit' as const,
                onPress: () => {
                  setLoad({ status: 'loading' });
                  setAttempt((previous) => previous + 1);
                },
              },
            },
          }
        : {})}
    >
      {load.status === 'error' ? (
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {t('onboarding.loadError')}
        </Text>
      ) : (
        <ActivityIndicator style={styles.spinner} color={colors.accent} accessibilityLabel={t('onboarding.loading')} />
      )}
      <AccountSection />
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
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: '#ffffff',
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
    fontSize: 14,
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
    fontSize: 12,
  },
  email: {
    color: colors.ink,
    fontSize: 15,
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
    backgroundColor: '#ffffff',
  },
  signOutLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  message: {
    color: colors.ink,
    fontSize: 15,
  },
  spinner: {
    marginVertical: spacing.lg,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
    paddingBottom: 6,
  },
});
