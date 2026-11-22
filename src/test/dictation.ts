// Drives the mocked expo-speech-recognition (jest.setup.ts) from a test: its methods as plain mocks,
// and recognition events emitted to every listener still subscribed.
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

type Listener = (event: unknown) => void;

/** The module's methods as standalone mocks (asserting on them never separates a method from `this`). */
export const recognition = ExpoSpeechRecognitionModule as unknown as {
  isRecognitionAvailable: jest.Mock<boolean, []>;
  supportsOnDeviceRecognition: jest.Mock<boolean, []>;
  requestPermissionsAsync: jest.Mock<Promise<{ granted: boolean; canAskAgain: boolean; status: string; expires: string }>, []>;
  start: jest.Mock<void, [unknown]>;
  stop: jest.Mock<void, []>;
  abort: jest.Mock<void, []>;
  addListener: jest.Mock<{ remove: jest.Mock }, [string, Listener]>;
};

export function emitRecognition(name: 'start' | 'result' | 'error' | 'end' | 'nomatch', event: unknown = null): void {
  const { calls, results } = recognition.addListener.mock;
  results.forEach((subscription, index) => {
    const call = calls.at(index);
    if (call === undefined || subscription.type !== 'return') return;
    const [eventName, listener] = call;
    if (eventName === name && subscription.value.remove.mock.calls.length === 0) listener(event);
  });
}

/** What the recognizer heard, then the end of the session, as the native module reports them. */
export function hear(transcript: string): void {
  emitRecognition('result', { isFinal: true, results: [{ transcript, confidence: 0.9, segments: [] }] });
  emitRecognition('end');
}
