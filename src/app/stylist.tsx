// "Ask your stylist": a chat about the user's closet, typed or dictated, with replies read aloud on
// request (docs/app.md#ask-your-stylist-srcstylist). Pushed from For you; nothing is kept.
import { router } from 'expo-router';
import { Check, Lock, RotateCw, Send, SquarePen, Star } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import type { ScrollViewInstance } from 'react-native';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCloset } from '../closet/ClosetProvider';
import { useI18n } from '../i18n';
import { localDate } from '../lib/localDate';
import type { AiError } from '../outfits/aiClient';
import { OutfitStack } from '../outfits/OutfitStack';
import { useWearLog } from '../outfits/useWearLog';
import { TURN_MAX_CHARS } from '../stylist/stylistClient';
import { type ChatMessage, useStylist } from '../stylist/useStylist';
import { BackChevron } from '../ui/BackChevron';
import { Screen, ScreenTitle } from '../ui/Screen';
import { colors, fontSizes, layout, radii, spacing } from '../ui/theme';
import { useDictation } from '../voice/dictation';
import { ListenButton } from '../voice/ListenButton';
import { MicButton } from '../voice/MicButton';

/** The errors the screen has copy for; the rest read as "unknown". */
function errorCopy(error: AiError): 'over_quota' | 'network' | 'unavailable' | 'unknown' {
  return error === 'over_quota' || error === 'network' || error === 'unavailable' ? error : 'unknown';
}

function SmallButton({
  label,
  icon: Icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: typeof Star;
  onPress: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.small, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}
    >
      <Icon size={14} color={colors.accentText} strokeWidth={2.5} />
      <Text style={styles.smallLabel}>{label}</Text>
    </Pressable>
  );
}

/** The suggested outfit with the pieces still in the closet; nothing when none is. */
function OutfitReply({ ids }: { ids: readonly string[] }): React.JSX.Element | null {
  const { t } = useI18n();
  const { garments, thumbUrls } = useCloset();
  const wear = useWearLog(localDate());
  const pieces = useMemo(() => {
    const byId = new Map(garments.map((garment) => [garment.id, garment]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }, [garments, ids]);
  if (pieces.length === 0) return null;
  const present = pieces.map((garment) => garment.id);
  const logged = wear.isLogged(present);
  return (
    <View style={styles.outfit}>
      <OutfitStack garments={pieces} thumbUrls={thumbUrls} compact />
      <View style={styles.row}>
        <SmallButton
          label={t('stylist.rate')}
          icon={Star}
          onPress={() => {
            router.push({ pathname: '/rate', params: { ids: present.join(',') } });
          }}
        />
        <SmallButton
          label={logged ? t('outfit.logged') : t('outfit.wear')}
          icon={Check}
          disabled={logged || wear.busy}
          onPress={() => {
            void wear.log(present, null);
          }}
        />
      </View>
    </View>
  );
}

function Bubble({ message, autoPlay }: { message: ChatMessage; autoPlay: boolean }): React.JSX.Element {
  const { t } = useI18n();
  if (message.role === 'user') {
    return (
      <View style={[styles.bubble, styles.userBubble]} accessible accessibilityLabel={t('stylist.saidUser', { text: message.text })}>
        <Text style={styles.userText}>{message.text}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.bubble, styles.stylistBubble]}>
      <View style={styles.replyRow}>
        <Text style={styles.replyText} accessibilityLabel={t('stylist.saidStylist', { text: message.text })}>
          {message.text}
        </Text>
        <ListenButton text={message.text} autoPlay={autoPlay} />
      </View>
      {message.outfit === null ? null : <OutfitReply ids={message.outfit} />}
    </View>
  );
}

export default function StylistScreen(): React.JSX.Element {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const stylist = useStylist();
  const [draft, setDraft] = useState('');
  const [speakReplies, setSpeakReplies] = useState(false);
  // Only a reply that arrives while "Speak replies" is on reads itself, never the older ones.
  const [autoPlayFrom, setAutoPlayFrom] = useState<number | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const dictation = useDictation((text) => {
    setDraft((current) => (current.trim() === '' ? text : `${current.trimEnd()} ${text}`).slice(0, TURN_MAX_CHARS));
  });

  const overQuota = stylist.error === 'over_quota';
  const canSend = draft.trim() !== '' && !stylist.sending && !overQuota;
  const lastId = stylist.messages.at(-1)?.id ?? 0;

  const send = (): void => {
    if (!canSend) return;
    const text = draft;
    setDraft('');
    setAutoPlayFrom(speakReplies ? lastId + 1 : null);
    void stylist.send(text);
  };

  return (
    <Screen scroll={false} chrome="none">
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView
          ref={scroll}
          style={styles.fill}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            scroll.current?.scrollToEnd({ animated: true });
          }}
        >
          <View style={styles.header}>
            <BackChevron
              label={t('stylist.back')}
              onPress={() => {
                router.back();
              }}
            />
            <View style={styles.headerTitle}>
              <ScreenTitle title={t('stylist.title')} />
            </View>
            <SmallButton
              label={t('stylist.newChat')}
              icon={SquarePen}
              onPress={() => {
                setDraft('');
                setAutoPlayFrom(null);
                stylist.newChat();
              }}
            />
          </View>
          <Text style={styles.intro}>{t('stylist.intro')}</Text>
          <View style={styles.row}>
            <Lock size={13} color={colors.muted} />
            <Text style={styles.muted}>{t('stylist.privacy')}</Text>
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('stylist.speakReplies')}</Text>
            <Switch
              accessibilityRole="switch"
              accessibilityLabel={t('stylist.speakReplies')}
              value={speakReplies}
              trackColor={{ true: colors.accent, false: colors.track }}
              onValueChange={setSpeakReplies}
            />
          </View>
          {stylist.messages.map((message) => (
            <Bubble key={message.id} message={message} autoPlay={autoPlayFrom !== null && message.id >= autoPlayFrom && speakReplies} />
          ))}
          {stylist.sending ? (
            <View style={styles.row} accessible accessibilityLabel={t('stylist.thinking')} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.muted}>{t('stylist.thinking')}</Text>
            </View>
          ) : null}
          {stylist.error === null ? null : (
            <View style={styles.errorBox}>
              <Text style={styles.errorText} accessibilityRole="alert">
                {t(`stylist.error.${errorCopy(stylist.error)}`)}
              </Text>
              {overQuota ? null : (
                <SmallButton
                  label={t('stylist.retry')}
                  icon={RotateCw}
                  onPress={() => {
                    setAutoPlayFrom(speakReplies ? lastId + 1 : null);
                    void stylist.retry();
                  }}
                />
              )}
            </View>
          )}
        </ScrollView>
        {dictation.problem === null ? null : (
          <Text style={[styles.muted, styles.problem]} accessibilityLiveRegion="polite">
            {t(`dictate.${dictation.problem}`)}
          </Text>
        )}
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <TextInput
            accessibilityLabel={t('stylist.input')}
            placeholder={t('stylist.input')}
            placeholderTextColor={colors.muted}
            value={draft}
            onChangeText={setDraft}
            editable={!overQuota}
            maxLength={TURN_MAX_CHARS}
            multiline
            style={styles.input}
          />
          <MicButton dictation={dictation} label={t('stylist.dictate')} size={40} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('stylist.send')}
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
            style={[styles.send, canSend ? null : styles.disabled]}
          >
            <Send size={18} color={colors.onFill} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    flex: 1,
  },
  intro: {
    color: colors.inkSoft,
    fontSize: fontSizes.body,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm - 2,
  },
  muted: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
    lineHeight: 18,
  },
  switchRow: {
    minHeight: layout.minHitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: {
    color: colors.ink,
    fontSize: fontSizes.body,
    fontWeight: '600',
  },
  bubble: {
    borderRadius: radii.card,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm + 4,
    maxWidth: '92%',
    gap: spacing.sm,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
  },
  userText: {
    color: colors.onFill,
    fontSize: fontSizes.body,
    lineHeight: 20,
  },
  stylistBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.glass[85],
    borderWidth: 1,
    borderColor: colors.glass[95],
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  replyText: {
    flex: 1,
    color: colors.ink,
    fontSize: fontSizes.body,
    lineHeight: 20,
  },
  outfit: {
    gap: spacing.sm,
  },
  small: {
    minHeight: layout.minHitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
  },
  smallLabel: {
    color: colors.accentText,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
  pressed: {
    backgroundColor: colors.tint,
  },
  disabled: {
    opacity: 0.45,
  },
  errorBox: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  errorText: {
    color: colors.ink,
    fontSize: fontSizes.body,
    fontWeight: '600',
    lineHeight: 20,
  },
  problem: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.glass[95],
  },
  input: {
    flex: 1,
    minHeight: layout.minHitTarget,
    maxHeight: 120,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: fontSizes.body,
  },
  send: {
    width: layout.minHitTarget,
    height: layout.minHitTarget,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
});
