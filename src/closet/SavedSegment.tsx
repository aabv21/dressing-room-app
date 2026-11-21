// The Closet tab's Saved segment: saved outfits newest first, each with Rate, "I'll wear it" and Delete.
// Deleting removes only the saved outfit; the diary and wear counts never change (docs/database.md).
import { router, useIsFocused } from 'expo-router';
import { RotateCw } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { pluralKey, useI18n, type Locale } from '../i18n';
import type { RequestError } from '../lib/requestResult';
import { localDate } from '../lib/localDate';
import { OutfitStack } from '../outfits/OutfitStack';
import { deleteSavedOutfit, type SavedOutfit } from '../outfits/savedOutfits';
import { useSavedOutfits } from '../outfits/useSavedOutfits';
import { useWearLog, type WearLog } from '../outfits/useWearLog';
import { colors, fontSizes, layout, radii, spacing } from '../ui/theme';
import { useCloset } from './ClosetProvider';
import type { Garment } from './garmentRepository';

const MINI_HEIGHT = 28;
const MINI_SLOP = (layout.minHitTarget - MINI_HEIGHT) / 2;

/** "November 20" in the device's time zone, with the year only when it isn't this one. */
export function formatSavedDate(locale: Locale, savedAt: string, now: Date = new Date()): string {
  const date = new Date(savedAt);
  const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function MiniButton({
  label,
  onPress,
  disabled = false,
  tone = 'plain',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'accent' | 'danger';
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={MINI_SLOP}
      onPress={onPress}
      style={[styles.mini, disabled ? styles.dimmed : null]}
    >
      <Text style={[styles.miniText, tone === 'accent' ? styles.miniAccent : tone === 'danger' ? styles.miniDanger : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function SavedCard({
  outfit,
  byId,
  thumbUrls,
  wearLog,
  busy,
  error,
  onDelete,
}: {
  outfit: SavedOutfit;
  byId: ReadonlyMap<string, Garment>;
  thumbUrls: Map<string, string>;
  wearLog: WearLog;
  busy: boolean;
  error: RequestError | null;
  onDelete: (outfit: SavedOutfit) => void;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const { garmentIds } = outfit;
  const pieces = useMemo(() => garmentIds.flatMap((id) => byId.get(id) ?? []), [garmentIds, byId]);
  // A saved outfit can lose a deleted piece (its item cascades); wearing or rating it then needs two.
  const usable = pieces.length >= 2;
  const logged = wearLog.isLogged(garmentIds);
  const wearError = wearLog.errorFor(garmentIds);
  const message = error === null ? (wearError === null ? null : t(`outfit.error.${wearError}`)) : t(`saved.deleteError.${error}`);
  return (
    <View style={styles.card} testID={`saved-outfit-${outfit.id}`}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {t('saved.title', { date: formatSavedDate(locale, outfit.savedAt) })}
        </Text>
        {outfit.score === null ? null : <Text style={styles.muted}>{`${String(outfit.score)}%`}</Text>}
      </View>
      <OutfitStack garments={pieces} thumbUrls={thumbUrls} compact />
      {message === null ? null : (
        <Text style={styles.error} accessibilityRole="alert">
          {message}
        </Text>
      )}
      <View style={styles.footer}>
        <MiniButton
          label={t('saved.rate')}
          disabled={!usable}
          onPress={() => {
            router.push({ pathname: '/rate', params: { ids: garmentIds.join(',') } });
          }}
        />
        {wearLog.canUndo(garmentIds) ? (
          <MiniButton
            label={t('outfit.undo')}
            tone="accent"
            disabled={wearLog.busy}
            onPress={() => {
              void wearLog.undo(garmentIds);
            }}
          />
        ) : null}
        <MiniButton
          label={logged ? t('outfit.logged') : t('outfit.wear')}
          tone="accent"
          disabled={logged || wearLog.busy || !usable}
          onPress={() => {
            void wearLog.log(garmentIds, null, outfit.score);
          }}
        />
        <MiniButton
          label={t('saved.delete')}
          tone="danger"
          disabled={busy}
          onPress={() => {
            onDelete(outfit);
          }}
        />
      </View>
    </View>
  );
}

/** The Saved segment's body, rendered under the Closet title and segment tabs. */
export function SavedSegment(): React.JSX.Element {
  const { t } = useI18n();
  const { garments, thumbUrls } = useCloset();
  const focused = useIsFocused();
  const { saved, offline, failed, reload, removeLocal } = useSavedOutfits(focused);
  const byId = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments]);
  const wearLog = useWearLog(localDate());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; error: RequestError } | null>(null);

  // One delete at a time: a second confirm tap (Android lets one through) is ignored before busy renders.
  const deleting = useRef(false);
  const remove = useCallback(
    async (outfit: SavedOutfit) => {
      if (deleting.current) return;
      deleting.current = true;
      setDeletingId(outfit.id);
      setDeleteError(null);
      const result = await deleteSavedOutfit(outfit.id);
      deleting.current = false;
      setDeletingId(null);
      if (!result.ok) {
        setDeleteError({ id: outfit.id, error: result.error });
        return;
      }
      removeLocal(outfit.id);
    },
    [removeLocal],
  );

  const confirmDelete = useCallback(
    (outfit: SavedOutfit) => {
      Alert.alert(t('saved.deleteTitle'), t('saved.deleteMessage'), [
        { text: t('saved.cancel'), style: 'cancel' },
        {
          text: t('saved.delete'),
          style: 'destructive',
          onPress: () => {
            void remove(outfit);
          },
        },
      ]);
    },
    [t, remove],
  );

  const count = saved?.length ?? 0;
  return (
    <View style={styles.body}>
      {count === 0 ? null : <Text style={styles.muted}>{t(pluralKey('saved.count', count), { count })}</Text>}
      {failed ? (
        <View style={styles.failed}>
          <Text style={styles.error}>{t('saved.error')}</Text>
          <Pressable accessibilityRole="button" onPress={reload} style={styles.retry}>
            <RotateCw size={14} color={colors.accentText} />
            <Text style={styles.retryLabel}>{t('saved.retry')}</Text>
          </Pressable>
        </View>
      ) : null}
      {offline ? <Text style={styles.offline}>{t('saved.offline')}</Text> : null}
      {saved === null && !failed ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
      {saved !== null && saved.length === 0 ? <Text style={styles.empty}>{t('saved.empty')}</Text> : null}
      {(saved ?? []).map((outfit) => (
        <SavedCard
          key={outfit.id}
          outfit={outfit}
          byId={byId}
          thumbUrls={thumbUrls}
          wearLog={wearLog}
          // Offline the delete can't reach the server.
          busy={deletingId !== null || offline}
          error={deleteError?.id === outfit.id ? deleteError.error : null}
          onDelete={confirmDelete}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm + 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.cell + 2,
    padding: spacing.sm + 4,
    gap: spacing.sm,
  },
  // Wraps the score under the date when a large text size leaves no room for both.
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
  },
  title: {
    flexShrink: 1,
    fontSize: fontSizes.body,
    fontWeight: '800',
    color: colors.ink,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  muted: {
    fontSize: fontSizes.caption,
    color: colors.muted,
  },
  error: {
    flexShrink: 1,
    fontSize: fontSizes.bodySmall,
    color: colors.error,
  },
  offline: {
    fontSize: fontSizes.bodySmall,
    color: colors.muted,
  },
  loading: {
    paddingVertical: spacing.md,
  },
  empty: {
    textAlign: 'center',
    fontSize: fontSizes.bodySmall,
    color: colors.muted,
    paddingVertical: spacing.sm,
  },
  failed: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  retry: {
    minHeight: layout.minHitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  retryLabel: {
    color: colors.accentText,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
  mini: {
    minHeight: MINI_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  miniText: {
    fontSize: fontSizes.caption,
    fontWeight: '700',
    color: colors.ink,
  },
  miniAccent: {
    color: colors.accentText,
  },
  miniDanger: {
    color: colors.error,
  },
  dimmed: {
    opacity: 0.4,
  },
});
