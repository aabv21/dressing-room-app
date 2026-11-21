import * as ImagePicker from 'expo-image-picker';
import { useCallback } from 'react';
import { Alert } from 'react-native';

import { useI18n } from '../i18n';
import { useUploadQueue } from './UploadQueueProvider';

const GALLERY_SELECTION_LIMIT = 30;

/** Picks up to 30 photos and hands them to the upload queue; true when any were enqueued. */
export function useGalleryImport(): { pickFromGallery: () => Promise<boolean> } {
  const { t } = useI18n();
  const { enqueue } = useUploadQueue();

  const pickFromGallery = useCallback(async () => {
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: GALLERY_SELECTION_LIMIT,
        quality: 1,
      });
    } catch {
      // The system picker failed to open (no photo access, a broken picker): say so.
      Alert.alert(t('closet.error.picker'));
      return false;
    }
    if (result.canceled) return false;
    enqueue(result.assets.map((asset) => asset.uri));
    return true;
  }, [enqueue, t]);

  return { pickFromGallery };
}
