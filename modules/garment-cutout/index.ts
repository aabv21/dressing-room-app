import { requireOptionalNativeModule } from 'expo';

export interface GarmentCutoutNative {
  /** iOS 17+ (Vision foreground masks); on Android, Google Play services is available. */
  isAvailable(): boolean;
  /**
   * Removes the background of the photo at `uri`. Resolves a `file://` PNG with alpha, cropped to
   * the subject and written to the caches directory, or `null` when no subject is found. Any native
   * error rejects.
   */
  cutOut(uri: string): Promise<string | null>;
}

// Optional so a build without the native module (Expo Go, web, an old dev client) gets `null`
// instead of a crash at import time.
export default requireOptionalNativeModule<GarmentCutoutNative>('GarmentCutout');
