// A garment's detail (spec §3.3 "Garment CRUD"): every attribute editable, the status, replacing
// the photo and deleting. No mockup of its own: it reuses mockup 02 review's photo, chip editors and
// anchored CTA. A root Stack screen inside the tabs guard (P3-R3), so there's no tab bar.
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Check, ChevronLeft, ImageIcon, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GARMENT_FIELDS } from '../../closet/catalog';
import { useCloset, usePendingPolling } from '../../closet/ClosetProvider';
import { isLivePending } from '../../closet/closetSelectors';
import { changedFields, FieldEditor, fieldValuesOf, type FieldValues } from '../../closet/GarmentFields';
import { GarmentPhoto } from '../../closet/GarmentPhoto';
import { deleteGarment, updateGarment, type Garment } from '../../closet/garmentRepository';
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

const STATUSES = Constants.public.Enums.garment_status;
const CLOCK_TICK_MS = 30_000;
// Room for a message shown above the buttons, so it never covers the last field.
const ERROR_ROOM = 56;

/** Back where the user came from; a deep link opens this screen with no history, so the closet. */
function leave(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/closet');
  }
}

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
    setSaving(false);
    if (!result.ok) {
      report({ action: 'save', error: result.error });
      return;
    }
    replaceLocal({ ...latest.current, ...patch });
    // Keeps only what changed again while the save was in flight.
    setDraft((current) => changedFields({ ...stored, ...patch }, { ...stored, ...current }));
  }, [garment.id, patch, stored, replaceLocal, report]);

  // The status saves on tap. The choice shows at once and stands until the stored status moves
  // (this save landing, or a refresh); a failed save drops it, reverting to the stored one.
  const [statusChoice, setStatusChoice] = useState<{ value: GarmentStatus; over: GarmentStatus } | null>(null);
  const statusRequest = useRef(0);
  if (statusChoice !== null && statusChoice.over !== garment.status) {
    // Storing derived state during render (React's documented pattern): the stored status moved.
    setStatusChoice(null);
  }
  const status = statusChoice !== null && statusChoice.over === garment.status ? statusChoice.value : garment.status;
  const changeStatus = useCallback(
    async (next: GarmentStatus) => {
      statusRequest.current += 1;
      const request = statusRequest.current;
      setStatusChoice({ value: next, over: latest.current.status });
      setFailure(null);
      const result = await updateGarment(garment.id, { status: next });
      // A later tap owns the chips now.
      if (request !== statusRequest.current) {
        return;
      }
      if (result.ok) {
        replaceLocal({ ...latest.current, status: next });
      } else {
        setStatusChoice(null);
        report({ action: 'save', error: result.error });
      }
    },
    [garment.id, replaceLocal, report],
  );
  const statusOptions = useMemo(
    () => STATUSES.map((value) => ({ value, label: t(`garment.status.${value}`) })),
    [t],
  );

  const [deleting, setDeleting] = useState(false);
  const remove = useCallback(async () => {
    setDeleting(true);
    setFailure(null);
    const result = await deleteGarment(garment.user_id, garment.id);
    if (result.ok) {
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 1,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset === undefined) {
      return;
    }
    enqueueReplacement(garment.id, asset.uri);
    setReplacedVersion(garment.photo_version);
  }, [enqueueReplacement, garment.id, garment.photo_version]);

  const title = garment.category === null ? t('garment.unnamed') : t(`garment.category.${garment.category}`);
  const message = failure === null ? null : failureText(failure, t);

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
            onPress={leave}
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
          <View style={styles.headerTitle}>
            <ScreenTitle title={title} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('garment.delete')}
            accessibilityState={{ disabled: deleting }}
            disabled={deleting}
            hitSlop={4}
            style={[styles.iconButton, styles.deleteButton, deleting ? styles.dimmed : null]}
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
              disabled={reading}
            />
          </View>
        ))}
      </ScrollView>
      <CtaBackdrop />
      <AnchoredCta
        chrome="none"
        // By the buttons, not at the end of the form, so it's on screen however far it scrolls.
        {...(message === null
          ? {}
          : {
              notice: (
                <Text style={styles.error} accessibilityRole="alert">
                  {message}
                </Text>
              ),
            })}
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
          disabled: !dirty || reading || saving || deleting,
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
      <AnchoredCta chrome="none" primary={{ label: t('garment.notFound.back'), tone: 'commit', onPress: leave }} />
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
    leave();
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
