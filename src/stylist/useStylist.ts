// "Ask your stylist"'s conversation: in memory only, so leaving the screen or "New chat" forgets it
// (docs/app.md#ask-your-stylist-srcstylist).
import { useCallback, useEffect, useRef, useState } from 'react';

import { useI18n } from '../i18n';
import { localDate } from '../lib/localDate';
import type { AiError } from '../outfits/aiClient';
import { askStylist, type ChatTurn, historyForRequest } from './stylistClient';

export type ChatMessage = ChatTurn & { id: number; outfit: string[] | null };

export type Stylist = {
  messages: ChatMessage[];
  sending: boolean;
  /** The last send's failure; the user's message stays, so "Try again" resends it. */
  error: AiError | null;
  send: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  newChat: () => void;
};

export function useStylist(): Stylist {
  const { locale } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<AiError | null>(null);
  // `busy` (the conversation sending) locks a second send before the re-render lands; `chat` bumps on
  // "New chat", so a late answer for the old conversation is dropped and doesn't unlock the new one.
  const busy = useRef<number | null>(null);
  const chat = useRef(0);
  const nextId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const ask = useCallback(
    async (history: ChatMessage[]) => {
      if (busy.current === chat.current) return;
      const conversation = chat.current;
      busy.current = conversation;
      setSending(true);
      setError(null);
      const outcome = await askStylist({ messages: historyForRequest(history), date: localDate(), language: locale });
      if (busy.current === conversation) busy.current = null;
      if (!mounted.current || conversation !== chat.current) return;
      setSending(false);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      nextId.current += 1;
      const answer: ChatMessage = {
        id: nextId.current,
        role: 'assistant',
        text: outcome.result.reply,
        outfit: outcome.result.outfit?.garment_ids ?? null,
      };
      setMessages([...history, answer]);
    },
    [locale],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '' || busy.current === chat.current || error === 'over_quota') return;
      nextId.current += 1;
      const next = [...messages, { id: nextId.current, role: 'user' as const, text: trimmed, outfit: null }];
      setMessages(next);
      await ask(next);
    },
    [ask, error, messages],
  );

  const retry = useCallback(async () => {
    if (messages.at(-1)?.role === 'user') await ask(messages);
  }, [ask, messages]);

  const newChat = useCallback(() => {
    chat.current += 1;
    setMessages([]);
    setSending(false);
    setError((current) => (current === 'over_quota' ? current : null));
  }, []);

  return { messages, sending, error, send, retry, newChat };
}
