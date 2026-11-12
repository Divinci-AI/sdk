/**
 * Retry helpers for polling loops.
 *
 * The shared HTTP client turns a request that exceeds its timeout into a
 * TimeoutError and does NOT retry it (only low-level network TypeErrors are
 * retried). For a command that polls an idempotent GET every few seconds for
 * minutes, one slow answer from a busy API must cost one poll, not the whole
 * command: measured 2026-10-07 on production, six parallel `rag crawl --wait`
 * calls over 20 pages ended with 14 of 20 exiting 1 on "Request timed out
 * after 30000ms" while the server went on to index every page.
 */

/** Per-request timeout for status polls. The client default (30 s) is for ordinary calls. */
export const POLL_REQUEST_TIMEOUT_MS = 60_000;

/** A timeout or a network-level failure: the request may well succeed if asked again. */
export function isTransientRequestError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: unknown; code?: unknown; message?: unknown };
  if (err.name === "TimeoutError" || err.code === "TIMEOUT") return true;
  if (err.name === "NetworkError") return true;
  const msg = String(err.message ?? "");
  return /timed out after \d+ms/i.test(msg) || /^Network error:/i.test(msg);
}

/** Consecutive slow polls a loop tolerates before it gives up and rethrows. */
export const MAX_CONSECUTIVE_SLOW_POLLS = 12;

/**
 * Wrap one poll's request so a transient failure costs that poll, not the
 * command: the wrapper returns undefined and the caller's loop sleeps and tries
 * again. A non-transient error, or too many slow polls in a row (a dead API),
 * still throws.
 */
export function createTolerantPoller(
  onSlow: (error: Error) => void,
  max = MAX_CONSECUTIVE_SLOW_POLLS,
): <T>(fn: () => Promise<T>) => Promise<T | undefined> {
  let slow = 0;
  return async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const value = await fn();
      slow = 0;
      return value;
    } catch (e) {
      if (!isTransientRequestError(e) || ++slow > max) throw e;
      onSlow(e as Error);
      return undefined;
    }
  };
}

export interface RetryTransientOptions {
  /** Retries after the first attempt. */
  retries?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number) => void;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run an idempotent request, retrying only transient failures. Anything else
 * (4xx, a malformed body, a thrown bug) is rethrown at once — retrying those
 * would only hide them.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  { retries = 3, baseMs = 1500, sleep = realSleep, onRetry }: RetryTransientOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || !isTransientRequestError(e)) throw e;
      onRetry?.(e, attempt + 1);
      await sleep(baseMs * 2 ** attempt);
    }
  }
}
