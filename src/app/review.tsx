// Mockup 02 screen 3: the review queue. The AI has already filled in each garment; the user goes
// through them one at a time and is only asked about what the AI doubted (`fieldsToAsk`). No tab
// bar (the mockup's `.cta.nobar`): a root Stack screen registered inside the tabs guard.
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GARMENT_FIELDS, type ClothingType, type GarmentField } from '../closet/catalog';
import { useCloset, usePendingPolling } from '../closet/ClosetProvider';
import { fieldsToAsk, isStalePending, reviewQueue } from '../closet/closetSelectors';
import { ConfirmedRow, FieldEditor, fieldValuesOf } from '../closet/GarmentFields';
import { confirmReview, type Garment } from '../closet/garmentRepository';
import { GarmentPhoto } from '../closet/GarmentPhoto';
import { leaveToCloset } from '../closet/leaveToCloset';
import { useNow } from '../closet/useNow';
import { useI18n } from '../i18n';
import type { RequestError } from '../lib/requestResult';
import { useClothingType } from '../profile/useClothingType';
import { AnchoredCta } from '../ui/AnchoredCta';
import { CtaBackdrop } from '../ui/CtaBackdrop';
import { ScreenTitle, useScreenContentInsets } from '../ui/Screen';
import { colors, gradients, radii, spacing } from '../ui/theme';

const CLOCK_TICK_MS = 30_000;
const ERROR_ROOM = 56;

// Mockup order: the basics as confirmed rows, then the questions, then the finer details.
const BASIC_FIELDS: readonly GarmentField[] = ['category', 'colors', 'seasons', 'formality'];
const DETAIL_FIELDS: readonly GarmentField[] = GARMENT_FIELDS.filter((field) => !BASIC_FIELDS.includes(field));

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
  const [values, setValues] = useState(() => fieldValuesOf(garment));
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
      AccessibilityInfo.announceForAccessibility(t(`closet.error.${result.error}`));
    }
  }, [garment, values, replaceLocal, onConfirmed, t]);

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
        contentContainerStyle={[
          styles.content,
          // Room for the error shown above the buttons, so it never covers the last field.
          { paddingTop: insets.top, paddingBottom: insets.bottom + (error === null ? 0 : ERROR_ROOM) },
        ]}
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
        <GarmentPhoto garment={garment} />
        <View>{BASIC_FIELDS.filter((field) => !asked.has(field)).map(row)}</View>
        {GARMENT_FIELDS.filter((field) => asked.has(field)).map((field) => (
          <View key={field} style={styles.doubt}>
            <Text style={styles.doubtText}>
              <Text style={styles.doubtLead}>{t('review.unsure')}</Text> {t(`review.ask.${field}`)}
            </Text>
            <FieldEditor
              field={field}
              values={values}
              onChange={setValues}
              clothingType={clothingType}
              narrowCategory={false}
            />
          </View>
        ))}
        <View>{DETAIL_FIELDS.filter((field) => !asked.has(field)).map(row)}</View>
      </ScrollView>
      <CtaBackdrop />
      <AnchoredCta
        chrome="none"
        // Next to the buttons, not at the end of the form, so it's on screen however far it scrolls.
        {...(error === null
          ? {}
          : {
              notice: (
                <Text style={styles.error} accessibilityRole="alert" testID="review-error">
                  {t(`closet.error.${error}`)}
                </Text>
              ),
            })}
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
          onPress: leaveToCloset,
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
  // The garment on screen, pinned by id from its first render: a garment joining the queue ahead
  // of it (polling: an extraction finishing, or a pending one turning stale) never swaps the card
  // and its draft. Its `created_at` places the next one when it leaves the queue (confirmed here or
  // gone elsewhere): the queue is oldest first, so the next is the first garment no older than it.
  const [pinned, setPinned] = useState<{ id: string; createdAt: number } | null>(null);

  const queue = useMemo(
    () => reviewQueue(garments, now).filter((g) => !confirmed.has(g.id)),
    [garments, now, confirmed],
  );
  let position = 0;
  if (pinned !== null) {
    const found = queue.findIndex((g) => g.id === pinned.id);
    const next = queue.findIndex((g) => Date.parse(g.created_at) >= pinned.createdAt);
    position = found !== -1 ? found : Math.max(next, 0);
  }
  const current = queue.at(position);
  if (current !== undefined && current.id !== pinned?.id) {
    // Storing derived state during render (React's documented pattern): pins the garment now shown.
    setPinned({ id: current.id, createdAt: Date.parse(current.created_at) });
  }

  const onSkip = useCallback(() => {
    const next = queue.at((position + 1) % queue.length);
    if (next !== undefined) {
      setPinned({ id: next.id, createdAt: Date.parse(next.created_at) });
    }
  }, [position, queue]);

  // The confirmed garment leaves the queue; the pin then resolves to the one after it.
  const onConfirmed = useCallback((id: string) => {
    setConfirmed((previous) => new Set(previous).add(id));
  }, []);

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
