import GarmentCutout from '../../../modules/garment-cutout';

/**
 * Cuts the garment out of the photo on-device. Resolves the cut-out PNG's `file://` URI, or `null`
 * whenever that isn't possible (module missing, unsupported platform, no subject, native error),
 * so callers fall back to the original photo. Never throws.
 */
export async function cutOutGarment(uri: string): Promise<string | null> {
  if (GarmentCutout === null) return null;
  try {
    if (!GarmentCutout.isAvailable()) return null;
    return await GarmentCutout.cutOut(uri);
  } catch {
    return null;
  }
}
