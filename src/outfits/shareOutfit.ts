// Captures the share card as a PNG and opens the system share sheet with it (docs/app.md#outfits-srcoutfits).
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

export type ShareOutcome = 'shared' | 'unavailable' | 'failed';

/** Never throws: a capture or share-sheet failure answers 'failed', so the caller shows a message. */
export async function shareOutfitImage(target: Parameters<typeof captureRef>[0], dialogTitle: string): Promise<ShareOutcome> {
  try {
    if (!(await Sharing.isAvailableAsync())) return 'unavailable';
    const uri = await captureRef(target, { format: 'png', quality: 1, result: 'tmpfile' });
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle });
    return 'shared';
  } catch {
    return 'failed';
  }
}
