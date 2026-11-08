// Stand-ins for `ClosetProvider` and `UploadQueueProvider` in suites that render the root layout
// or a whole route tree but don't test the closet. The real providers load the Supabase client,
// SQLite and the photo pipeline at import time. Use with:
//
//   jest.mock('../closet/ClosetProvider', () => require('../test/closetProvidersMock'));
//   jest.mock('../closet/UploadQueueProvider', () => require('../test/closetProvidersMock'));
//
// Both providers render their children; the hooks report an empty, ready closet and an empty queue.

const noop = (): void => undefined;
const emptyThumbs = new Map<string, string>();

export function ClosetProvider({ children }: { children?: React.ReactNode }): React.ReactNode {
  return children;
}

export function UploadQueueProvider({ children }: { children?: React.ReactNode }): React.ReactNode {
  return children;
}

export function useCloset() {
  return {
    garments: [],
    thumbUrls: emptyThumbs,
    status: 'ready' as const,
    refresh: () => Promise.resolve(),
    replaceLocal: noop,
    removeLocal: noop,
  };
}

export function usePendingPolling(): void {
  // Nothing pending in the empty closet.
}

export function useUploadQueue() {
  return {
    pending: 0,
    failed: 0,
    enqueue: noop,
    enqueueReplacement: noop,
    retryFailed: noop,
    discardFailed: noop,
  };
}
