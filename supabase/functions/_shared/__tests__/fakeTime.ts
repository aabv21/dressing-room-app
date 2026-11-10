// Fake-time driving for the functions' latency tests. The handlers hash their cache keys with the
// real `crypto.subtle.digest`, which settles on Node's thread pool, outside fake time: if fake time
// moves on while a digest is still pending, a slow machine (CI) spends the handler's latency budget
// before it ever calls Jev. `drive` therefore waits for every pending digest before each step.
// `jest` is a global only inside test files under ESM, so the test passes it in.

export function fakeTime(j: typeof jest) {
  const pendingDigests = new Set<Promise<ArrayBuffer>>();
  let restore: (() => void) | undefined;

  return {
    /** Records every `crypto.subtle.digest` call so `drive` can wait for it; call in `beforeEach`. */
    trackDigests: (): void => {
      const original = crypto.subtle.digest.bind(crypto.subtle);
      const spy = j.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, data) => {
        const digest = original(algorithm, data);
        pendingDigests.add(digest);
        void digest.finally(() => pendingDigests.delete(digest));
        return digest;
      });
      restore = () => {
        spy.mockRestore();
      };
    },

    /** Restores the real `crypto.subtle.digest`; call in `afterEach`. */
    untrackDigests: (): void => {
      restore?.();
      restore = undefined;
      pendingDigests.clear();
    },

    /** Lets real macrotasks and every pending digest settle, then advances fake time by `step`. */
    drive: async (ms: number, step = 50): Promise<void> => {
      for (let elapsed = 0; elapsed < ms; elapsed += step) {
        do {
          for (let turn = 0; turn < 3; turn += 1) await new Promise((resolve) => setImmediate(resolve));
          if (pendingDigests.size > 0) await Promise.allSettled([...pendingDigests]);
        } while (pendingDigests.size > 0);
        await j.advanceTimersByTimeAsync(Math.min(step, ms - elapsed));
      }
    },
  };
}
