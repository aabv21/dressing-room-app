import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

import { cutOutGarment } from './cutout';

type Target = { longestSide: number; compress: number };

const FULL: Target = { longestSide: 784, compress: 0.8 };
const THUMB: Target = { longestSide: 256, compress: 0.7 };

/** Brings the longer side down to `target` (`null`: never upscale); one side keeps the aspect ratio. */
export function resizeFor(width: number, height: number, target: number): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= target) return null;
  return width >= height ? { width: target } : { height: target };
}

function deleteQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing left to clean up.
  }
}

/** Out of the caches directory, which the OS may purge while an item waits offline; the queue deletes it on commit. */
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
 * Renders again resized if a decoder ignored its load options; every image rendered goes to `images` so
 * the caller can release it.
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
 * One decode, downsampled while decoding (iOS CGImageSource with EXIF orientation, Android Glide), so a
 * 48 MP photo never sits in memory at full size; the thumbnail comes from the full image. The cut-out PNG is temporary.
 * NOTE: an Android loader ignoring the bounds decodes in full; upgrade: cap it in garment-cutout's decoder too.
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

/**
 * "Should I buy it?"'s photo: the same cut-out and 784 px WebP as an upload, answered as base64 and never
 * kept (the saved WebP and the cut-out are deleted). Throws when the photo can't be decoded.
 */
export async function prepareCheckPhoto(sourceUri: string): Promise<string> {
  const cutoutUri = await cutOutGarment(sourceUri);
  const contexts: Context[] = [];
  const images: ImageRef[] = [];
  let savedUri: string | null = null;
  try {
    const context = ImageManipulator.manipulate(cutoutUri ?? sourceUri, { maxWidth: FULL.longestSide, maxHeight: FULL.longestSide });
    contexts.push(context);
    const full = await renderWithin(context, FULL.longestSide, images);
    const saved = await full.saveAsync({ format: SaveFormat.WEBP, compress: FULL.compress, base64: true });
    savedUri = saved.uri;
    if (saved.base64 === undefined) throw new Error('no base64 from the encoder');
    return saved.base64;
  } finally {
    for (const image of images) image.release();
    for (const context of contexts) context.release();
    if (savedUri !== null) deleteQuietly(savedUri);
    if (cutoutUri !== null) deleteQuietly(cutoutUri);
  }
}
