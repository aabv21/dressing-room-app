import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

import { cutOutGarment } from './cutout';

type Target = { longestSide: number; compress: number };

const FULL: Target = { longestSide: 784, compress: 0.8 };
const THUMB: Target = { longestSide: 256, compress: 0.7 };

/**
 * The resize that brings the longer side down to `target`, or `null` when it is already no longer
 * than that (never upscaled). Only one side is given, so the manipulator keeps the aspect ratio.
 */
export function resizeFor(width: number, height: number, target: number): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= target) return null;
  return width >= height ? { width: target } : { height: target };
}

/** Deletes a file, ignoring one that is already gone. */
function deleteQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing left to clean up.
  }
}

/**
 * Moves a manipulator output out of the caches directory (which the OS may purge while an item
 * waits offline) into `Paths.document/uploads/`, next to the queue item's source copy. The queue
 * deletes it once the item commits.
 */
function moveIntoUploads(uri: string): string {
  const uploads = new Directory(Paths.document, 'uploads');
  uploads.create({ intermediates: true, idempotent: true });
  const file = new File(uri);
  const destination = new File(uploads, file.name);
  file.moveSync(destination, { overwrite: true });
  return destination.uri;
}

/** Encodes `uri` as WebP with its longer side at most `target.longestSide`; resolves the file's URI. */
async function encode(uri: string, target: Target): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  const images: ImageRef[] = [];
  try {
    const original = await context.renderAsync();
    images.push(original);
    const resize = resizeFor(original.width, original.height, target.longestSide);
    let image = original;
    if (resize !== null) {
      image = await context.resize(resize).renderAsync();
      images.push(image);
    }
    const saved = await image.saveAsync({ format: SaveFormat.WEBP, compress: target.compress });
    return moveIntoUploads(saved.uri);
  } finally {
    // Decoded bitmaps are large; free them now rather than whenever the JS garbage collector runs.
    for (const each of images) each.release();
    context.release();
  }
}

/**
 * Turns a queued photo into the two WebPs that get uploaded: the garment cut out on-device when
 * possible (the original photo otherwise), then a 784 px full image at quality 0.8 and a 256 px
 * thumbnail at 0.7. The cut-out PNG is a temporary file and is always deleted afterwards.
 *
 * NOTE: when there is no cut-out, each encode decodes the source photo at full resolution (a
 * 48 MP photo is ~190 MB of pixels). Ceiling: memory on low-end Android; upgrade path: pass
 * `manipulate(uri, { maxWidth, maxHeight })` to downsample while decoding.
 */
export async function preparePhoto(sourceUri: string): Promise<{ fullUri: string; thumbUri: string }> {
  const cutoutUri = await cutOutGarment(sourceUri);
  const input = cutoutUri ?? sourceUri;
  try {
    const fullUri = await encode(input, FULL);
    try {
      const thumbUri = await encode(input, THUMB);
      return { fullUri, thumbUri };
    } catch (error) {
      // The queue retries `prepare` from the source, so a half-prepared pair is only litter.
      deleteQuietly(fullUri);
      throw error;
    }
  } finally {
    if (cutoutUri !== null) deleteQuietly(cutoutUri);
  }
}
