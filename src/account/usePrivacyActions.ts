import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { useUploadQueue } from '../closet/UploadQueueProvider';
import type { MessageKey } from '../i18n';
import { useI18n } from '../i18n';
import { announceForAccessibility } from '../ui/a11y';
import { exportData, exportFileName } from './accountClient';
import { deletionMessage, runDeletion } from './deletionFlow';
import { removeExports } from './deviceFiles';

type Action = { run: () => void; busy: boolean; error: MessageKey | undefined };

/** Keeps state updates for a screen that may unmount mid-request (a deletion signs out). */
function useMounted(): { readonly current: boolean } {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * The Profile tab's Privacy actions. One flow at a time: from the moment an export starts or the
 * first delete confirm opens until it ends (or is cancelled), a second tap on either does nothing.
 *
 * "Export my data": the share sheet must be available; then the `export-data` document replaces
 * any earlier export in the cache directory as `dressing-room-export-YYYY-MM-DD.json` and goes to
 * the share sheet. A failure of the function, the file or the share sheet shows one message.
 *
 * "Delete account": two confirms, then `runDeletion` (see `deletionFlow.ts`). A deletion lands on
 * Welcome; `reauth` shows its message in an Alert, since the local sign-out takes this screen
 * away; any other failure keeps the user here with a message.
 */
export function usePrivacyActions(): { exporting: Action; deleting: Action } {
  const { t } = useI18n();
  const { userId } = useAuth();
  const queue = useUploadQueue();
  const mounted = useMounted();
  const active = useRef(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<MessageKey | undefined>(undefined);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<MessageKey | undefined>(undefined);

  const runExport = useCallback(() => {
    if (active.current) return;
    active.current = true;
    setExportError(undefined);
    setExportBusy(true);
    void (async () => {
      let failure: MessageKey | undefined;
      try {
        if (!(await Sharing.isAvailableAsync())) {
          failure = 'profile.privacy.shareUnavailable';
        } else {
          const outcome = await exportData();
          if (outcome.ok) {
            // Only the newest copy of the data stays in the cache directory.
            removeExports();
            const file = new File(Paths.cache, exportFileName());
            await file.write(JSON.stringify(outcome.result, null, 2));
            await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
          } else {
            failure = 'profile.privacy.exportError';
          }
        }
      } catch {
        failure = 'profile.privacy.exportError';
      }
      active.current = false;
      if (!mounted.current) return;
      setExportBusy(false);
      if (failure !== undefined) {
        setExportError(failure);
        announceForAccessibility(t(failure));
      }
    })();
  }, [t, mounted]);

  const remove = useCallback(async () => {
    if (userId === null) {
      active.current = false;
      return;
    }
    setDeleteError(undefined);
    setDeleteBusy(true);
    const result = await runDeletion(userId, queue);
    active.current = false;
    const message = deletionMessage(result);
    if (result === 'reauth' && message !== undefined) {
      Alert.alert(t(message));
      announceForAccessibility(t(message));
      return;
    }
    if (!mounted.current) return;
    setDeleteBusy(false);
    if (message !== undefined) {
      setDeleteError(message);
      announceForAccessibility(t(message));
    }
  }, [userId, queue, mounted, t]);

  const runDelete = useCallback(() => {
    if (active.current) return;
    active.current = true;
    const cancel = {
      text: t('profile.privacy.cancel'),
      style: 'cancel' as const,
      onPress: () => {
        active.current = false;
      },
    };
    let confirmed = false;
    Alert.alert(t('profile.privacy.deleteTitle'), t('profile.privacy.deleteMessage'), [
      cancel,
      {
        text: t('profile.privacy.deleteContinue'),
        onPress: () => {
          Alert.alert(t('profile.privacy.deleteConfirmTitle'), t('profile.privacy.deleteConfirmMessage'), [
            cancel,
            {
              text: t('profile.privacy.deleteForever'),
              style: 'destructive',
              onPress: () => {
                if (confirmed) return;
                confirmed = true;
                void remove();
              },
            },
          ]);
        },
      },
    ]);
  }, [t, remove]);

  return {
    exporting: { run: runExport, busy: exportBusy, error: exportError },
    deleting: { run: runDelete, busy: deleteBusy, error: deleteError },
  };
}
