// "Should I buy it?"'s flow: a photo shot or picked, prepared on the device, then checked; nothing
// outlives the screen (docs/app.md#should-i-buy-it-srcbuycheck).
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { deletePhoto, prepareCheckPhoto } from '../closet/upload/preparePhoto';
import { useUploadQueue } from '../closet/UploadQueueProvider';
import { useI18n } from '../i18n';
import { localDate } from '../lib/localDate';
import type { AiError } from '../outfits/aiClient';
import { checkPurchase, type BuyCheckResponse } from './buyCheckClient';

export type PhotoSource = 'camera' | 'gallery';

export type BuyCheckState =
  | { step: 'idle' }
  | { step: 'checking' }
  | { step: 'done'; result: BuyCheckResponse; added: boolean }
  /** `photo`: the device couldn't decode the picked photo, so nothing was sent. */
  | { step: 'failed'; error: AiError | 'photo' };

type Translate = ReturnType<typeof useI18n>['t'];

/** The picked or shot photo's URI; null when canceled, denied or the picker failed (each said in an alert). */
async function pickPhoto(source: PhotoSource, t: Translate): Promise<string | null> {
  try {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('buyCheck.cameraDenied'));
        return null;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: false });
    if (result.canceled) return null;
    return result.assets[0]?.uri ?? null;
  } catch {
    Alert.alert(t('closet.error.picker'));
    return null;
  }
}

export function useBuyCheck(): {
  state: BuyCheckState;
  start: (source: PhotoSource) => Promise<void>;
  retry: () => Promise<void>;
  add: () => void;
  reset: () => void;
} {
  const { t, locale } = useI18n();
  const { enqueue } = useUploadQueue();
  const [state, setState] = useState<BuyCheckState>({ step: 'idle' });
  // The source URI (for "Add to my closet") and its prepared base64 (for a retry without re-picking).
  const photo = useRef<{ uri: string; image: string } | null>(null);
  // A camera shot sits in the app's cache until deleted; a gallery pick is the user's own photo.
  const shot = useRef<string | null>(null);
  const busy = useRef(false);

  // "Add to my closet" copies the shot into the queue first, so it can go whether added or not.
  const discardShot = useCallback(() => {
    if (shot.current !== null) deletePhoto(shot.current);
    shot.current = null;
  }, []);

  useEffect(() => discardShot, [discardShot]);

  const send = useCallback(
    async (image: string) => {
      setState({ step: 'checking' });
      const outcome = await checkPurchase({ image, date: localDate(), language: locale });
      setState(outcome.ok ? { step: 'done', result: outcome.result, added: false } : { step: 'failed', error: outcome.error });
    },
    [locale],
  );

  const run = useCallback(async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await work();
    } finally {
      busy.current = false;
    }
  }, []);

  const start = useCallback(
    (source: PhotoSource) =>
      run(async () => {
        const uri = await pickPhoto(source, t);
        if (uri === null) return;
        if (source === 'camera') shot.current = uri;
        setState({ step: 'checking' });
        let image: string;
        try {
          image = await prepareCheckPhoto(uri);
        } catch {
          photo.current = null;
          discardShot();
          setState({ step: 'failed', error: 'photo' });
          return;
        }
        photo.current = { uri, image };
        await send(image);
      }),
    [run, send, t, discardShot],
  );

  const retry = useCallback(
    () =>
      run(async () => {
        if (photo.current !== null) await send(photo.current.image);
      }),
    [run, send],
  );

  const add = useCallback(() => {
    const current = photo.current;
    if (current === null || state.step !== 'done' || state.added) return;
    // The upload queue prepares the original photo again, as any gallery import; a failed copy was alerted.
    if (enqueue([current.uri]) > 0) setState({ ...state, added: true });
  }, [enqueue, state]);

  const reset = useCallback(() => {
    photo.current = null;
    discardShot();
    setState({ step: 'idle' });
  }, [discardShot]);

  return { state, start, retry, add, reset };
}
