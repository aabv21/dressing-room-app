import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';

const EXPORT_FILE = /^dressing-room-export-.*\.json$/;

/** Removes every data export ("Export my data") left in the cache directory. */
export function removeExports(): void {
  for (const entry of Paths.cache.list()) {
    if (entry instanceof File && EXPORT_FILE.test(entry.name)) {
      entry.delete();
    }
  }
}

/**
 * After a confirmed deletion: drops the exports (they hold the profile, body measurements
 * included) and expo-image's memory and disk caches (garment photos). Best effort, each step on
 * its own: a failure leaves that copy behind but never stops the rest of the cleanup.
 */
export async function forgetDeviceFiles(): Promise<void> {
  try {
    removeExports();
  } catch {
    // The cache directory is the OS's to purge; the next export replaces whatever stayed.
  }
  // Through async callbacks, so a call that throws instead of rejecting is settled as well.
  await Promise.allSettled([() => Image.clearMemoryCache(), () => Image.clearDiskCache()].map(async (clear) => clear()));
}
