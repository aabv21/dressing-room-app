// A garment's detail (spec §3.3 "Garment CRUD"): every attribute editable, the status, replacing
// the photo and deleting. No mockup of its own: it reuses mockup 02 review's photo, chip editors and
// anchored CTA. A root Stack screen inside the tabs guard, so there's no tab bar.
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { Check, ChevronLeft, ImageIcon, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GARMENT_FIELDS } from '../../closet/catalog';
import { useCloset, usePendingPolling } from '../../closet/ClosetProvider';
import { isLivePending } from '../../closet/closetSelectors';
import { changedFields, FieldEditor, fieldValuesOf, type FieldValues } from '../../closet/GarmentFields';
import { GarmentPhoto } from '../../closet/GarmentPhoto';
import { deleteGarment, updateGarment, type Garment } from '../../closet/garmentRepository';
import { leaveToCloset } from '../../closet/leaveToCloset';
import { useUploadQueue } from '../../closet/UploadQueueProvider';
import { useNow } from '../../closet/useNow';
import { formatWearCount, useI18n } from '../../i18n';
import { Constants } from '../../lib/database.types';
import type { RequestError } from '../../lib/requestResult';
import { useClothingType } from '../../profile/useClothingType';
import { AnchoredCta } from '../../ui/AnchoredCta';
import { ChipGroup } from '../../ui/ChipGroup';
import { CtaBackdrop } from '../../ui/CtaBackdrop';
import { ScreenTitle, useScreenContentInsets } from '../../ui/Screen';
import { colors, gradients, layout, radii, spacing } from '../../ui/theme';

type GarmentStatus = Garment['status'];

// Donating happens only from Stats' unused list, a deliberate action; the picker never offers it.
const STATUSES = Constants.public.Enums.garment_status.filter((value) => value !== 'donated');
const CLOCK_TICK_MS = 30_000;
// Room for a message shown above the buttons, so it never covers the last field.
const ERROR_ROOM = 56;

type Failure = { action: 'save' | 'delete'; error: RequestError };

function failureText(failure: Failure, t: ReturnType<typeof useI18n>['t']): string {
  return failure.action === 'delete' ? t(`garment.deleteError.${failure.error}`) : t(`closet.error.${failure.error}`);
}

function GarmentDetail({ garment, onDeleted }: { garment: Garment; onDeleted: () => void }): React.JSX.Element {
  const { t, locale } = useI18n();
  const insets = useScreenContentInsets('none');
  const clothingType = useClothingType();
  const { replaceLocal } = useCloset();
  const { enqueueReplacement, pending: uploading } = useUploadQueue();

  // A pending garment counts as failed after 10 minutes; until then the AI may still overwrite
  // the attributes, so they aren't editable yet and the closet keeps polling for the result.
  const now = useNow(CLOCK_TICK_MS);
  const reading = isLivePending(garment, now);
  usePendingPolling(useIsFocused() && reading);

  // The stored row as of now, for a save that finishes after a refresh replaced the prop.
  const latest = useRef(garment);
  useEffect(() => {
    latest.current = garment;
  }, [garment]);
  // False once the screen is gone or the garment deleted: a late save result must not bring the
  // garment back into the closet through `replaceLocal`.
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const [failure, setFailure] = useState<Failure | null>(null);
  const report = useCallback(
    (next: Failure) => {
      setFailure(next);
      AccessibilityInfo.announceForAccessibility(failureText(next, t));
    },
    [t],
  );

  // Only the edited fields are kept, so a refresh (e.g. the AI's result) still shows in the others.
  const stored = useMemo(() => fieldValuesOf(garment), [garment]);
  const [draft, setDraft] = useState<Partial<FieldValues>>({});
  const values = useMemo<FieldValues>(() => ({ ...stored, ...draft }), [stored, draft]);
  const patch = useMemo(() => changedFields(stored, values), [stored, values]);
  const dirty = Object.keys(patch).length > 0;
  const onChange = useCallback(
    (next: FieldValues) => {
      setDraft(changedFields(stored, next));
    },
    [stored],
  );

  const [saving, setSaving] = useState(false);
  const save = useCallback(async () => {
    setSaving(true);
    setFailure(null);
    const result = await updateGarment(garment.id, patch);
    if (!active.current) {
      return;
    }
    setSaving(false);
    if (!result.ok) {
      report({ action: 'save', error: result.error });
      return;
    }
    replaceLocal({ ...latest.current, ...patch });
    // Keeps only what changed again while the save was in flight.
    setDraft((current) => changedFields({ ...stored, ...patch }, { ...stored, ...current }));
  }, [garment.id, patch, stored, replaceLocal, report]);

  // The status saves on tap, one save at a time: the chips are disabled until it lands. The tapped
  // chip shows at once; a failure goes back to the last confirmed status. A refresh that moves the
  // stored status resets the confirmed one to it.
  const [statusSaving, setStatusSaving] = useState<GarmentStatus | null>(null);
  const [confirmedStatus, setConfirmedStatus] = useState({ stored: garment.status, value: garment.status });
  if (confirmedStatus.stored !== garment.status) {
    // Storing derived state during render (React's documented pattern): the stored status moved.
    setConfirmedStatus({ stored: garment.status, value: garment.status });
  }
  const status = statusSaving ?? confirmedStatus.value;
  const changeStatus = useCallback(
    async (next: GarmentStatus) => {
      setStatusSaving(next);
      setFailure(null);
      const result = await updateGarment(garment.id, { status: next });
      if (!active.current) {
        return;
      }
      setStatusSaving(null);
      if (result.ok) {
        setConfirmedStatus((current) => ({ ...current, value: next }));
        replaceLocal({ ...latest.current, status: next });
      } else {
        report({ action: 'save', error: result.error });
      }
    },
    [garment.id, replaceLocal, report],
  );
  const [deleting, setDeleting] = useState(false);
  // One write at a time: a field save, a status save and a delete each wait for the others, so
  // no two `replaceLocal` calls race from different snapshots and a late save can't re-add a
  // deleted garment.
  const busy = saving || statusSaving !== null;
  // While the AI reads the photo the status waits too: any write moves `updated_at`, and the
  // extraction's guarded write-back would then skip, losing what it read.
  const statusLocked = busy || deleting || reading;
  const statusOptions = useMemo(
    () => STATUSES.map((value) => ({ value, label: t(`garment.status.${value}`), disabled: statusLocked })),
    [t, statusLocked],
  );

  const remove = useCallback(async () => {
    setDeleting(true);
    setFailure(null);
    const result = await deleteGarment(garment.user_id, garment.id);
    if (!active.current) {
      return;
    }
    if (result.ok) {
      active.current = false;
      onDeleted();
      return;
    }
    setDeleting(false);
    report({ action: 'delete', error: result.error });
  }, [garment.user_id, garment.id, onDeleted, report]);
  const confirmDelete = useCallback(() => {
    Alert.alert(t('garment.delete.title'), t('garment.delete.message'), [
      { text: t('garment.delete.cancel'), style: 'cancel' },
      {
        text: t('garment.delete.confirm'),
        style: 'destructive',
        onPress: () => {
          void remove();
        },
      },
    ]);
  }, [t, remove]);

  // The new photo uploads through the queue; this says so until the garment's photo version moves.
  const [replacedVersion, setReplacedVersion] = useState<number | null>(null);
  const replacing = replacedVersion === garment.photo_version && uploading > 0;
  const replacePhoto = useCallback(async () => {
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      });
    } catch {
      // The system picker failed to open (no photo access, a broken picker): say so.
      Alert.alert(t('closet.error.picker'));
      return;
    }
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset === undefined) {
      return;
    }
    enqueueReplacement(garment.id, asset.uri);
    setReplacedVersion(garment.photo_version);
  }, [enqueueReplacement, garment.id, garment.photo_version, t]);

  const title = garment.category === null ? t('garment.unnamed') : t(`garment.category.${garment.category}`);
  // A reviewed garment must keep a category: without one it drops out of the slots and suggestions.
  const missingCategory = values.category === null && !reading;
  let message: React.ReactNode = null;
  if (failure !== null) {
    message = (
      <Text style={styles.error} accessibilityRole="alert">
        {failureText(failure, t)}
      </Text>
    );
  } else if (missingCategory) {
    message = <Text style={styles.hint}>{t('garment.categoryRequired')}</Text>;
  }

  return (
    <LinearGradient colors={gradients.background} style={styles.fill}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top, paddingBottom: insets.bottom + (message === null ? 0 : ERROR_ROOM) },
        ]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('garment.back')}
            // Narrower than 44 pt so the title sits close to it; the slop keeps the 44 pt target.
            hitSlop={{ left: 8, right: 6 }}
            style={styles.backButton}
            onPress={leaveToCloset}
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
          <View style={styles.headerTitle}>
            <ScreenTitle title={title} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('garment.delete')}
            accessibilityState={{ disabled: deleting || busy }}
            disabled={deleting || busy}
            hitSlop={4}
            style={[styles.iconButton, styles.deleteButton, deleting || busy ? styles.dimmed : null]}
            onPress={confirmDelete}
          >
            <Trash2 size={20} color={colors.error} />
          </Pressable>
        </View>
        {replacing ? <Text style={styles.notice}>{t('garment.replacing')}</Text> : null}
        <GarmentPhoto garment={garment} />
        <Text style={styles.wears}>{formatWearCount(garment.wear_count, locale)}</Text>
        <View style={styles.section}>
          <Text style={styles.label}>{t('garment.status')}</Text>
          {garment.status === 'donated' ? (
            <Text style={styles.donated}>{t('garment.status.donated')}</Text>
          ) : (
            <ChipGroup
              options={statusOptions}
              selected={[status]}
              multiple={false}
              accessibilityLabel={t('garment.status')}
              onChange={(next) => {
                // A radio that can't be cleared: tapping the chosen status again does nothing.
                const picked = next[0];
                if (picked !== undefined) {
                  void changeStatus(picked);
                }
              }}
            />
          )}
        </View>
        {reading ? <Text style={styles.notice}>{t('garment.reading')}</Text> : null}
        {GARMENT_FIELDS.map((field) => (
          <View key={field} style={styles.section}>
            <Text style={styles.label}>{t(`garment.field.${field}`)}</Text>
            <FieldEditor
              field={field}
              values={values}
              onChange={onChange}
              clothingType={clothingType}
              // Every category, so a shirt can become a jacket in one tap.
              narrowCategory={false}
              disabled={reading}
            />
          </View>
        ))}
      </ScrollView>
      <CtaBackdrop />
      <AnchoredCta
        chrome="none"
        // By the buttons, not at the end of the form, so it's on screen however far it scrolls.
        {...(message === null ? {} : { notice: message })}
        secondary={{
          label: t('garment.replacePhoto'),
          tone: 'ghost',
          icon: ImageIcon,
          disabled: deleting,
          onPress: () => {
            void replacePhoto();
          },
        }}
        primary={{
          label: t('garment.save'),
          tone: 'commit',
          icon: Check,
          disabled: !dirty || missingCategory || reading || busy || deleting,
          onPress: () => {
            void save();
          },
        }}
      />
    </LinearGradient>
  );
}

function NotFound(): React.JSX.Element {
  const { t } = useI18n();
  const insets = useScreenContentInsets('none');
  return (
    <LinearGradient colors={gradients.background} style={styles.fill}>
      <View style={[styles.content, styles.notFound, { paddingTop: insets.top }]}>
        <Text style={styles.notFoundTitle}>{t('garment.notFound.title')}</Text>
        <Text style={styles.notFoundBody}>{t('garment.notFound.body')}</Text>
      </View>
      <AnchoredCta chrome="none" primary={{ label: t('garment.notFound.back'), tone: 'commit', onPress: leaveToCloset }} />
    </LinearGradient>
  );
}

export default function GarmentDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { garments, status, removeLocal } = useCloset();
  const [leaving, setLeaving] = useState(false);
  const garment = garments.find((g) => g.id === id);

  // Navigates first, so the garment vanishing from the closet never flashes "not found" here.
  const onDeleted = useCallback(() => {
    setLeaving(true);
    leaveToCloset();
    removeLocal(id);
  }, [id, removeLocal]);

  if (leaving) {
    return <LinearGradient colors={gradients.background} style={styles.fill} />;
  }
  if (garment === undefined) {
    // On a cold deep link the closet may still be loading: wait for it before saying "not found".
    return status === 'loading' ? (
      <LinearGradient colors={gradients.background} style={[styles.fill, styles.loading]}>
        <ActivityIndicator color={colors.accent} />
      </LinearGradient>
    ) : (
      <NotFound />
    );
  }
  return <GarmentDetail key={garment.id} garment={garment} onDeleted={onDeleted} />;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm + 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerTitle: {
    flex: 1,
  },
  iconButton: {
    minWidth: layout.minHitTarget,
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
  },
  backButton: {
    width: 30,
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  deleteButton: {
    alignItems: 'flex-end',
  },
  dimmed: {
    opacity: 0.4,
  },
  wears: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: '#eee9f8',
  },
  label: {
    color: colors.muted,
    fontSize: 14,
  },
  donated: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  notice: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.cell,
    borderWidth: 1,
    borderColor: colors.tintBorder,
    backgroundColor: colors.tint,
    color: colors.accentText,
    fontSize: 14,
    fontWeight: '600',
  },
  hint: {
    alignSelf: 'center',
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.cell,
    backgroundColor: colors.tint,
    textAlign: 'center',
    color: colors.accentText,
    fontSize: 14,
  },
  error: {
    alignSelf: 'center',
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.cell,
    backgroundColor: colors.errorTint,
    textAlign: 'center',
    color: colors.error,
    fontSize: 14,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  notFoundTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  notFoundBody: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
});
