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

type Context = ReturnType<typeof ImageManipulator.manipulate>;

/**
 * Renders `context`, then, if the result is still longer than `longestSide` (a decoder that
 * ignored its load options), renders it again resized. Every image rendered is pushed to `images`
 * so the caller can release it.
 */
async function renderWithin(context: Context, longestSide: number, images: ImageRef[]): Promise<ImageRef> {
  const rendered = await context.renderAsync();
  images.push(rendered);
  const resize = resizeFor(rendered.width, rendered.height, longestSide);
  if (resize === null) return rendered;
  const resized = await context.resize(resize).renderAsync();
  images.push(resized);
  return resized;
}

async function saveWebp(image: ImageRef, target: Target): Promise<string> {
  const saved = await image.saveAsync({ format: SaveFormat.WEBP, compress: target.compress });
  return moveIntoUploads(saved.uri);
}

/**
 * Turns a queued photo into the two WebPs that get uploaded: the garment cut out on-device when
 * possible (the original photo otherwise), then a 784 px full image at quality 0.8 and a 256 px
 * thumbnail at 0.7. The cut-out PNG is a temporary file and is always deleted afterwards.
 *
 * The source is decoded once, downsampled while decoding to fit 784 px (iOS: CGImageSource with
 * EXIF orientation applied; Android: Glide's bounded decode; neither upscales), so a 48 MP photo
 * never exists in memory at full size. The thumbnail is then built from that rendered full image
 * rather than from the source again.
 *
 * NOTE: the bounded decode is only as lean as the platform loader: Android hands the bounds to the
 * app's image loader and, if that loader ignores them, decodes in full before downscaling. Ceiling:
 * one full-size bitmap per worker on such a loader; upgrade path: cap the source in the
 * garment-cutout module's decoder (already 2048 px for cut-outs) for the no-cut-out path too.
 */
export async function preparePhoto(sourceUri: string): Promise<{ fullUri: string; thumbUri: string }> {
  const cutoutUri = await cutOutGarment(sourceUri);
  const input = cutoutUri ?? sourceUri;
  const contexts: Context[] = [];
  const images: ImageRef[] = [];
  let fullUri: string | null = null;
  try {
    const fullContext = ImageManipulator.manipulate(input, { maxWidth: FULL.longestSide, maxHeight: FULL.longestSide });
    contexts.push(fullContext);
    const full = await renderWithin(fullContext, FULL.longestSide, images);
    fullUri = await saveWebp(full, FULL);

    const thumbContext = ImageManipulator.manipulate(full);
    contexts.push(thumbContext);
    const thumb = await renderWithin(thumbContext, THUMB.longestSide, images);
    const thumbUri = await saveWebp(thumb, THUMB);
    return { fullUri, thumbUri };
  } catch (error) {
    // The queue retries `prepare` from the source, so a half-prepared pair is only litter.
    if (fullUri !== null) deleteQuietly(fullUri);
    throw error;
  } finally {
    // Decoded bitmaps are large; free them now rather than whenever the JS garbage collector runs.
    for (const image of images) image.release();
    for (const context of contexts) context.release();
    if (cutoutUri !== null) deleteQuietly(cutoutUri);
  }
}
