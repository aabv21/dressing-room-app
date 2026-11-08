// Mockup 02 screen 3: the review queue. The AI has already filled in each garment; the user goes
// through them one at a time and is only asked about what the AI doubted (`fieldsToAsk`). No tab
// bar (the mockup's `.cta.nobar`): a root Stack screen registered inside the tabs guard (P3-R3).
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';

import { GARMENT_FIELDS, type ClothingType, type GarmentField } from '../closet/catalog';
import { useCloset, usePendingPolling } from '../closet/ClosetProvider';
import { fieldsToAsk, isStalePending, reviewQueue } from '../closet/closetSelectors';
import { ConfirmedRow, FieldEditor, type FieldValues } from '../closet/GarmentFields';
import { confirmReview, garmentPhotoPath, signedPhotoUrls, type Garment } from '../closet/garmentRepository';
import { useNow } from '../closet/useNow';
import { useI18n } from '../i18n';
import type { RequestError } from '../lib/requestResult';
import { useClothingType } from '../profile/useClothingType';
import { AnchoredCta } from '../ui/AnchoredCta';
import { useBottomChrome } from '../ui/layout';
import { ScreenTitle, useScreenContentInsets } from '../ui/Screen';
import { colors, gradients, radii, spacing } from '../ui/theme';

const CLOCK_TICK_MS = 30_000;

// Mockup order: the basics as confirmed rows, then the questions, then the finer details.
const BASIC_FIELDS: readonly GarmentField[] = ['category', 'colors', 'seasons', 'formality'];
const DETAIL_FIELDS: readonly GarmentField[] = GARMENT_FIELDS.filter((field) => !BASIC_FIELDS.includes(field));

function valuesOf(g: Garment): FieldValues {
  const { category, colors: garmentColors, pattern, material, formality, seasons, warmth, fit, occasions } = g;
  return { category, colors: garmentColors, pattern, material, formality, seasons, warmth, fit, occasions };
}

/** A signed URL for the garment's full photo, or null until it is signed (or if signing failed). */
function useFullPhotoUrl(g: Garment): string | null {
  const path = garmentPhotoPath(g.user_id, g.id, 'full');
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null);

  useEffect(() => {
    let current = true;
    signedPhotoUrls([path]).then(
      (urls) => {
        const url = urls.get(path);
        if (current && url !== undefined) {
          setSigned({ path, url });
        }
      },
      // Offline: the checkerboard stays empty and the fields still work.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [path]);

  return signed !== null && signed.path === path ? signed.url : null;
}

/** Mockup 02's `.garment`: a transparency checkerboard behind the cut-out photo. */
function PhotoBox({ garment }: { garment: Garment }): React.JSX.Element {
  const { t } = useI18n();
  const url = useFullPhotoUrl(garment);
  const source = useMemo(
    () => (url === null ? null : { uri: url, cacheKey: `${garment.id}:full:${String(garment.photo_version)}` }),
    [url, garment.id, garment.photo_version],
  );
  return (
    <View style={styles.photo}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <Pattern id="checker" width={16} height={16} patternUnits="userSpaceOnUse">
            <Rect width={16} height={16} fill="#ffffff" />
            <Path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#f1eef7" />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#checker)" />
      </Svg>
      {source === null ? null : (
        <Image
          source={source}
          style={styles.photoImage}
          cachePolicy="disk"
          contentFit="contain"
          transition={100}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('review.photo')}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

/**
 * Mockup 02's `.cta.nobar` fade reaches the screen's bottom edge. AnchoredCta's zone ends
 * `ctaBottom` above it, so fields scrolling under the buttons would show through that strip; this
 * fills it with the background's last color.
 */
function CtaBackdrop(): React.JSX.Element {
  const { ctaBottom } = useBottomChrome('none');
  return <View style={[styles.ctaBackdrop, { height: ctaBottom }]} pointerEvents="none" />;
}

function ReviewCard(props: {
  garment: Garment;
  now: number;
  clothingType: ClothingType;
  index: number;
  total: number;
  onSkip: () => void;
  onConfirmed: (id: string) => void;
}): React.JSX.Element {
  const { garment, now, clothingType, index, total, onSkip, onConfirmed } = props;
  const { t } = useI18n();
  const insets = useScreenContentInsets('none');
  const { replaceLocal } = useCloset();
  // Fixed for this garment: answering a question doesn't turn it into a confirmed row mid-review.
  const [asked] = useState(() => new Set(fieldsToAsk(garment, now)));
  const [values, setValues] = useState(() => valuesOf(garment));
  const [editing, setEditing] = useState<ReadonlySet<GarmentField>>(() => new Set());
  const [error, setError] = useState<RequestError | null>(null);
  const [saving, setSaving] = useState(false);

  const confirm = useCallback(async () => {
    setSaving(true);
    setError(null);
    const result = await confirmReview(garment.id, values);
    setSaving(false);
    if (result.ok) {
      replaceLocal({ ...garment, ...values, reviewed_at: new Date().toISOString() });
      onConfirmed(garment.id);
    } else {
      setError(result.error);
    }
  }, [garment, values, replaceLocal, onConfirmed]);

  let notice: string | null = null;
  if (garment.extraction_status === 'over_quota') {
    notice = t('review.overQuota');
  } else if (garment.extraction_status === 'failed' || isStalePending(garment, now)) {
    notice = t('review.failed');
  }

  const row = (field: GarmentField): React.JSX.Element =>
    editing.has(field) ? (
      <View key={field} style={styles.editingRow}>
        <Text style={styles.editingLabel}>{t(`garment.field.${field}`)}</Text>
        <FieldEditor field={field} values={values} onChange={setValues} clothingType={clothingType} />
      </View>
    ) : (
      <ConfirmedRow
        key={field}
        field={field}
        values={values}
        onEdit={() => {
          setEditing((current) => new Set(current).add(field));
        }}
      />
    );

  return (
    <LinearGradient colors={gradients.background} style={styles.fill}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        <View style={styles.titleRow}>
          <ScreenTitle title={t('review.title')} />
          <Text style={styles.progressText}>{t('review.progress', { index, total })}</Text>
        </View>
        <View style={styles.track}>
          <LinearGradient
            colors={gradients.ai}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.trackFill, { width: `${String((index / total) * 100)}%` }]}
          />
        </View>
        {notice === null ? null : <Text style={styles.notice}>{notice}</Text>}
        <PhotoBox garment={garment} />
        <View>{BASIC_FIELDS.filter((field) => !asked.has(field)).map(row)}</View>
        {GARMENT_FIELDS.filter((field) => asked.has(field)).map((field) => (
          <View key={field} style={styles.doubt}>
            <Text style={styles.doubtText}>
              <Text style={styles.doubtLead}>{t('review.unsure')}</Text> {t(`review.ask.${field}`)}
            </Text>
            <FieldEditor field={field} values={values} onChange={setValues} clothingType={clothingType} />
          </View>
        ))}
        <View>{DETAIL_FIELDS.filter((field) => !asked.has(field)).map(row)}</View>
        {error === null ? null : (
          <Text style={styles.error} accessibilityRole="alert">
            {t(`closet.error.${error}`)}
          </Text>
        )}
      </ScrollView>
      <CtaBackdrop />
      <AnchoredCta
        chrome="none"
        secondary={{ label: t('review.skip'), tone: 'ghost', onPress: onSkip, disabled: saving }}
        primary={{
          label: t('review.confirm'),
          tone: 'commit',
          icon: Check,
          disabled: saving || values.category === null,
          onPress: () => {
            void confirm();
          },
        }}
      />
    </LinearGradient>
  );
}

function CaughtUp(): React.JSX.Element {
  const { t } = useI18n();
  const insets = useScreenContentInsets('none');
  return (
    <LinearGradient colors={gradients.background} style={styles.fill}>
      <View style={[styles.content, { paddingTop: insets.top }]}>
        <ScreenTitle title={t('review.title')} />
        <View style={styles.caughtUp}>
          <Text style={styles.caughtUpTitle}>{t('review.done.title')}</Text>
          <Text style={styles.caughtUpBody}>{t('review.done.body')}</Text>
        </View>
      </View>
      <AnchoredCta
        chrome="none"
        primary={{
          label: t('review.done.back'),
          tone: 'commit',
          onPress: () => {
            router.back();
          },
        }}
      />
    </LinearGradient>
  );
}

export default function ReviewScreen(): React.JSX.Element {
  usePendingPolling(useIsFocused());
  const { garments } = useCloset();
  const clothingType = useClothingType();
  // A pending garment joins the queue once it turns stale (10 minutes).
  const now = useNow(CLOCK_TICK_MS);
  // Confirmed here: dropped from the queue even if a refresh that started earlier brings back the
  // unreviewed row, and counted so "3 of 12" keeps moving forward.
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(() => new Set());
  // The current garment by id, so items joining the queue (polling) never swap it mid-review; the
  // index is the fallback once that garment has left the queue.
  const [cursor, setCursor] = useState<{ id: string | null; index: number }>({ id: null, index: 0 });

  const queue = useMemo(
    () => reviewQueue(garments, now).filter((g) => !confirmed.has(g.id)),
    [garments, now, confirmed],
  );
  const found = cursor.id === null ? -1 : queue.findIndex((g) => g.id === cursor.id);
  const position = found === -1 ? (cursor.index < queue.length ? cursor.index : 0) : found;
  const current = queue.at(position);

  const onSkip = useCallback(() => {
    const next = (position + 1) % queue.length;
    setCursor({ id: queue.at(next)?.id ?? null, index: next });
  }, [position, queue]);

  const onConfirmed = useCallback(
    (id: string) => {
      const remaining = queue.filter((g) => g.id !== id);
      const next = position < remaining.length ? position : 0;
      setConfirmed((previous) => new Set(previous).add(id));
      setCursor({ id: remaining.at(next)?.id ?? null, index: next });
    },
    [position, queue],
  );

  if (current === undefined) {
    return <CaughtUp />;
  }

  return (
    <ReviewCard
      key={current.id}
      garment={current}
      now={now}
      clothingType={clothingType}
      index={confirmed.size + position + 1}
      total={confirmed.size + queue.length}
      onSkip={onSkip}
      onConfirmed={onConfirmed}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm + 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  progressText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  track: {
    height: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: radii.pill,
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
  photo: {
    aspectRatio: 252 / 150,
    borderRadius: 16,
    overflow: 'hidden',
  },
  photoImage: {
    flex: 1,
  },
  editingRow: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: '#eee9f8',
  },
  editingLabel: {
    color: colors.muted,
    fontSize: 14,
  },
  doubt: {
    gap: spacing.sm,
    padding: 10,
    borderRadius: radii.cell,
    borderWidth: 1,
    borderColor: colors.tintBorder,
    backgroundColor: colors.tint,
  },
  doubtText: {
    color: colors.ink,
    fontSize: 14,
  },
  doubtLead: {
    fontWeight: '700',
  },
  error: {
    color: colors.error,
    fontSize: 14,
  },
  ctaBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: gradients.background[2],
  },
  caughtUp: {
    marginTop: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  caughtUpTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  caughtUpBody: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
});
