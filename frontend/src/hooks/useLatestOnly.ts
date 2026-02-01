import { useRef, useCallback } from 'react';

/**
 * useLatestOnly Hook
 *
 * Provides a mechanism to run async functions while ensuring only the latest
 * invocation's result is processed. Stale responses from earlier calls are
 * automatically discarded.
 *
 * This prevents race conditions where rapid filter changes could cause older
 * responses to overwrite newer state (e.g., numbers jumping back).
 *
 * Usage:
 * ```tsx
 * const { runLatest } = useLatestOnly();
 *
 * const fetchData = async () => {
 *   await runLatest(async (signal) => {
 *     const result = await someAsyncCall();
 *
 *     // Check signal before setting state
 *     if (!signal.isStale) {
 *       setData(result);
 *     }
 *   });
 * };
 * ```
 */
export function useLatestOnly() {
  const latestRequestId = useRef(0);

  const runLatest = useCallback(
    async <T>(
      fn: (signal: { isStale: boolean; requestId: number }) => Promise<T>
    ): Promise<T | undefined> => {
      // Increment and capture request ID
      latestRequestId.current += 1;
      const currentRequestId = latestRequestId.current;

      // Create signal object that can be checked for staleness
      const signal = {
        get isStale() {
          return currentRequestId !== latestRequestId.current;
        },
        requestId: currentRequestId,
      };

      try {
        const result = await fn(signal);

        // Final staleness check before returning
        if (signal.isStale) {
          console.log(
            `[useLatestOnly] Discarding stale request ${currentRequestId} (latest: ${latestRequestId.current})`
          );
          return undefined;
        }

        return result;
      } catch (error) {
        // Discard stale errors
        if (signal.isStale) {
          console.log(
            `[useLatestOnly] Discarding stale error for request ${currentRequestId}`
          );
          return undefined;
        }
        throw error;
      }
    },
    []
  );

  return { runLatest };
}
