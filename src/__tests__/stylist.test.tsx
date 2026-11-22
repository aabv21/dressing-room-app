// "Ask your stylist": the chat, dictation into the input, Listen and "Speak replies", an outfit reply
// with Rate it and I'll wear it, New chat, and the error states. The call and the closet are mocked.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Speech from 'expo-speech';

import StylistScreen from '../app/stylist';
import type { Garment } from '../closet/garmentRepository';
import type { AiOutcome } from '../outfits/aiClient';
import { askStylist, type StylistResponse } from '../stylist/stylistClient';
import { announceForAccessibility } from '../ui/a11y';
import { emitRecognition, hear, recognition } from '../test/dictation';
import { garment } from '../test/garmentFixture';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, useIsFocused: () => true }));
const mockLocales = { tags: ['en-US'] };
jest.mock('expo-localization', () => ({
  getLocales: () => mockLocales.tags.map((languageTag) => ({ languageTag, languageCode: languageTag.slice(0, 2) })),
}));
jest.mock('../lib/supabase', () => ({ supabase: {} }));
jest.mock('../ui/a11y', () => ({ announceForAccessibility: jest.fn() }));
jest.mock('../lib/localDate', () => ({ localDate: () => '2026-11-21' }));
jest.mock('../stylist/stylistClient', () => ({ ...jest.requireActual<object>('../stylist/stylistClient'), askStylist: jest.fn() }));
const mockLog = jest.fn<Promise<string>, [readonly string[], unknown]>(() => Promise.resolve('logged'));
const mockLogged = { ids: new Set<string>() };
jest.mock('../outfits/useWearLog', () => ({
  useWearLog: () => ({
    log: mockLog,
    busy: false,
    isLogged: (ids: readonly string[]) => mockLogged.ids.has(ids.join(',')),
    errorFor: () => null,
    clearError: jest.fn(),
    isQueued: () => false,
    canUndo: () => false,
    undo: jest.fn(),
    undoFailedFor: () => false,
  }),
}));

const TEE = '40000000-0000-4000-8000-000000000001';
const JEANS = '40000000-0000-4000-8000-000000000002';
const GONE = '40000000-0000-4000-8000-000000000009';
const mockCloset: { garments: Garment[] } = { garments: [] };
jest.mock('../closet/ClosetProvider', () => ({
  useCloset: () => ({ garments: mockCloset.garments, thumbUrls: new Map<string, string>(), status: 'ready', refresh: () => Promise.resolve() }),
}));

const mockedAsk = jest.mocked(askStylist);
const mockedPush = jest.mocked(router.push);
const mockedSpeak = jest.mocked(Speech.speak);
const mockedAnnounce = jest.mocked(announceForAccessibility);

const reply = (text: string, outfit?: string[]): AiOutcome<StylistResponse> => ({
  ok: true,
  result: { kind: 'ok', reply: text, ...(outfit === undefined ? {} : { outfit: { garment_ids: outfit } }) },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLocales.tags = ['en-US'];
  mockLogged.ids = new Set();
  mockCloset.garments = [
    garment({ id: TEE, category: 't_shirt', colors: ['white'], extraction_status: 'done' }),
    garment({ id: JEANS, category: 'jeans', colors: ['navy'], extraction_status: 'done' }),
  ];
  mockedAsk.mockResolvedValue(reply('Try your navy jeans with the white tee.'));
});

async function type(text: string): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText('Message your stylist'), text);
}

async function send(text: string): Promise<void> {
  await type(text);
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
}

test('explains the chat and that Anthropic gets the messages and a closet summary the app doesn’t keep', async () => {
  await render(<StylistScreen />);
  expect(screen.getByRole('header', { name: 'Ask your stylist' })).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Your messages and a summary of your closet go to Anthropic to answer them. The app and its server don't store them; Anthropic applies its own retention rules.",
    ),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('sends the message with the local day and the language, then shows the reply with a Listen button', async () => {
  await render(<StylistScreen />);
  await send('  What should I wear today?  ');

  expect(mockedAsk).toHaveBeenCalledWith({
    messages: [{ role: 'user', text: 'What should I wear today?' }],
    date: '2026-11-21',
    language: 'en',
  });
  expect(await screen.findByText('Try your navy jeans with the white tee.')).toBeOnTheScreen();
  expect(screen.getByText('What should I wear today?')).toBeOnTheScreen();
  expect(screen.getByLabelText('Message your stylist')).toHaveProp('value', '');
  expect(await screen.findByRole('button', { name: 'Listen' })).toBeOnTheScreen();
});

test('the next message carries the conversation so far', async () => {
  await render(<StylistScreen />);
  await send('What should I wear today?');
  await screen.findByText('Try your navy jeans with the white tee.');
  mockedAsk.mockResolvedValue(reply('Add the white sneakers.'));
  await send('And shoes?');

  expect(mockedAsk).toHaveBeenLastCalledWith(
    expect.objectContaining({
      messages: [
        { role: 'user', text: 'What should I wear today?' },
        { role: 'assistant', text: 'Try your navy jeans with the white tee.' },
        { role: 'user', text: 'And shoes?' },
      ],
    }),
  );
});

test('dictation fills the input', async () => {
  await render(<StylistScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Dictate a message' }));
  await waitFor(() => {
    expect(recognition.start).toHaveBeenCalled();
  });
  await act(() => {
    hear('something for a dinner');
  });
  expect(screen.getByLabelText('Message your stylist')).toHaveProp('value', 'something for a dinner');
});

test('dictation that heard nothing says so under the field', async () => {
  await render(<StylistScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Dictate a message' }));
  await waitFor(() => {
    expect(recognition.start).toHaveBeenCalled();
  });
  await act(() => {
    emitRecognition('end');
  });
  expect(screen.getByText("Didn't catch that. Try again.")).toBeOnTheScreen();
});

test('starting dictation stops a reply being read aloud', async () => {
  await render(<StylistScreen />);
  await send('What should I wear today?');
  await fireEvent.press(await screen.findByRole('button', { name: 'Listen' }));
  expect(mockedSpeak).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Dictate a message' }));
  await waitFor(() => {
    expect(Speech.stop).toHaveBeenCalled();
  });
  expect(screen.getByRole('button', { name: 'Listen' })).toBeOnTheScreen();
});

test('with "Speak replies" on, a new reply is read aloud in the app language', async () => {
  await render(<StylistScreen />);
  await fireEvent(screen.getByRole('switch', { name: 'Speak replies' }), 'valueChange', true);
  await send('What should I wear today?');

  await waitFor(() => {
    expect(mockedSpeak).toHaveBeenCalledWith('Try your navy jeans with the white tee.', expect.objectContaining({ language: 'en-US' }));
  });
});

test('a new reply is announced to VoiceOver and is a polite live region for TalkBack', async () => {
  await render(<StylistScreen />);
  await send('What should I wear today?');
  const replyText = await screen.findByText('Try your navy jeans with the white tee.');
  expect(replyText).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(mockedAnnounce).toHaveBeenCalledWith('Stylist: Try your navy jeans with the white tee.');
});

test('with "Speak replies" on, the reply is read aloud instead of announced', async () => {
  await render(<StylistScreen />);
  await fireEvent(screen.getByRole('switch', { name: 'Speak replies' }), 'valueChange', true);
  await send('What should I wear today?');
  await waitFor(() => {
    expect(mockedSpeak).toHaveBeenCalled();
  });
  expect(mockedAnnounce).not.toHaveBeenCalledWith('Stylist: Try your navy jeans with the white tee.');
});

test('"Speak replies" doesn’t read a reply that arrives while dictation is listening, not even afterwards', async () => {
  let answer: (outcome: AiOutcome<StylistResponse>) => void = () => undefined;
  mockedAsk.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  await render(<StylistScreen />);
  await fireEvent(screen.getByRole('switch', { name: 'Speak replies' }), 'valueChange', true);
  await send('What should I wear today?');
  await fireEvent.press(screen.getByRole('button', { name: 'Dictate a message' }));
  await waitFor(() => {
    expect(recognition.start).toHaveBeenCalled();
  });
  await act(() => {
    answer(reply('Try your navy jeans with the white tee.'));
  });
  await screen.findByText('Try your navy jeans with the white tee.');
  await act(() => {
    hear('and shoes');
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockedSpeak).not.toHaveBeenCalled();
});

test('turning "Speak replies" off stops the reply being read', async () => {
  await render(<StylistScreen />);
  const toggle = screen.getByRole('switch', { name: 'Speak replies' });
  await fireEvent(toggle, 'valueChange', true);
  await send('What should I wear today?');
  await waitFor(() => {
    expect(mockedSpeak).toHaveBeenCalled();
  });
  await fireEvent(toggle, 'valueChange', false);
  expect(Speech.stop).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Listen' })).toBeOnTheScreen();
});

test('with "Speak replies" off, nothing is read until Listen is tapped', async () => {
  await render(<StylistScreen />);
  await send('What should I wear today?');
  await screen.findByText('Try your navy jeans with the white tee.');
  expect(mockedSpeak).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByRole('button', { name: 'Listen' }));
  expect(mockedSpeak).toHaveBeenCalledTimes(1);
});

test('an outfit reply shows the pieces still in the closet, with Rate it and I’ll wear it', async () => {
  mockedAsk.mockResolvedValue(reply('The white tee and navy jeans.', [TEE, JEANS, GONE]));
  await render(<StylistScreen />);
  await send('Pick my outfit');

  expect(await screen.findByTestId(`outfit-piece-${TEE}`)).toBeOnTheScreen();
  expect(screen.getByTestId(`outfit-piece-${JEANS}`)).toBeOnTheScreen();
  expect(screen.queryByTestId(`outfit-piece-${GONE}`)).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Rate it' }));
  expect(mockedPush).toHaveBeenCalledWith({ pathname: '/rate', params: { ids: `${TEE},${JEANS}` } });

  await fireEvent.press(screen.getByRole('button', { name: "I'll wear it" }));
  expect(mockLog).toHaveBeenCalledWith([TEE, JEANS], null);
});

test('an outfit whose pieces are all gone shows only the reply', async () => {
  mockedAsk.mockResolvedValue(reply('That one.', [GONE]));
  await render(<StylistScreen />);
  await send('Pick my outfit');
  await screen.findByText('That one.');
  expect(screen.queryByRole('button', { name: 'Rate it' })).toBeNull();
});

test('New chat clears the conversation', async () => {
  await render(<StylistScreen />);
  await send('What should I wear today?');
  await screen.findByText('Try your navy jeans with the white tee.');
  await fireEvent.press(screen.getByRole('button', { name: 'New chat' }));

  expect(screen.queryByText('Try your navy jeans with the white tee.')).toBeNull();
  expect(screen.queryByText('What should I wear today?')).toBeNull();
  mockedAsk.mockClear();
  await send('Hi');
  expect(mockedAsk).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: 'user', text: 'Hi' }] }));
});

test('over the quota it says so and stops sending', async () => {
  mockedAsk.mockResolvedValue({ ok: false, error: 'over_quota' });
  await render(<StylistScreen />);
  await send('What should I wear today?');

  expect(await screen.findByText("You've used today's 20 messages. Come back tomorrow.")).toBeOnTheScreen();
  await type('Another one');
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

test.each([
  ['network', "Couldn't reach your stylist. Check your internet and try again."],
  ['unavailable', "Your stylist couldn't answer right now. Try again in a moment."],
  ['unknown', 'Something went wrong. Try again.'],
] as const)('a %s failure keeps the message and offers Try again, which resends it', async (error, copy) => {
  mockedAsk.mockResolvedValueOnce({ ok: false, error });
  await render(<StylistScreen />);
  await send('What should I wear today?');

  expect(await screen.findByText(copy)).toBeOnTheScreen();
  expect(screen.getByText('What should I wear today?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(mockedAsk).toHaveBeenCalledTimes(2);
  expect(mockedAsk).toHaveBeenLastCalledWith(expect.objectContaining({ messages: [{ role: 'user', text: 'What should I wear today?' }] }));
  expect(await screen.findByText('Try your navy jeans with the white tee.')).toBeOnTheScreen();
});

test('reads in Spanish', async () => {
  mockLocales.tags = ['es-CO'];
  await render(<StylistScreen />);
  expect(screen.getByRole('header', { name: 'Pregúntale a tu estilista' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Nuevo chat' })).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('Escríbele a tu estilista'), '¿Qué me pongo?');
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar' }));
  expect(mockedAsk).toHaveBeenCalledWith(expect.objectContaining({ language: 'es' }));
});

test('Back leaves the screen', async () => {
  await render(<StylistScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  expect(router.back).toHaveBeenCalled();
});
