/**
 * Retry the one failure class where retrying is PROVABLY safe: the request never left the
 * machine. The 2026-11-14 incident lost DNS for a second (`EAI_AGAIN`), one /mcp POST
 * failed, and the client got an HTML 500 — that container had 72 such failures over 12 days.
 *
 * `fetch` is the right choke point: every query, `db.batch()` and transaction is ONE HTTP
 * POST, so wrapping it covers the whole data layer without touching a call site. Only
 * pre-send failures are retried — a reset or timeout AFTER send may already have committed,
 * and retrying it would duplicate the write.
 */
import { neonConfig } from "@neondatabase/serverless";
import { isPreSendNetworkError } from "./errors.ts";

/** Total attempts per request: 1 try + 2 retries. */
export const RETRY_ATTEMPTS = 3;

/** First backoff step in ms; doubled per retry, then jittered. */
export const RETRY_BASE_DELAY_MS = 150;

/** Same argument shape as native `fetch` (what the driver calls it with). */
type FetchArgs = Parameters<typeof fetch>;
type FetchLike = (...args: FetchArgs) => Promise<Response>;

/**
 * Marks a wrapper that already retries. Read across module re-evaluations
 * (Bun's `--hot` re-runs modules), so a hot reload cannot stack wrappers and
 * silently turn 3 attempts into 9.
 */
const RETRY_MARKER = Symbol.for("sepia.db.retryingFetch");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Exponential backoff with jitter, so parallel queries don't retry in lockstep. */
function backoffMs(attempt: number): number {
  const step = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  return step + Math.floor(Math.random() * RETRY_BASE_DELAY_MS);
}

/**
 * Can this body be sent again? The driver always posts `JSON.stringify(...)`,
 * which is re-readable. A stream is not — replaying one would send an empty
 * request and get a confusing error, so we refuse rather than corrupt it.
 */
function bodyIsReplayable(init: FetchArgs[1]): boolean {
  const body = init?.body;
  return body == null || typeof body === "string" || body instanceof Uint8Array;
}

/**
 * Wrap a `fetch` implementation so pre-send connection failures are retried.
 * Exported for tests — `installFetchRetry()` is the production entry point.
 */
export function createRetryingFetch(base: FetchLike): FetchLike {
  const wrapped = (async (...args: FetchArgs): Promise<Response> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await base(...args);
      } catch (error) {
        const exhausted = attempt >= RETRY_ATTEMPTS;
        if (
          exhausted ||
          !isPreSendNetworkError(error) ||
          !bodyIsReplayable(args[1])
        ) {
          throw error;
        }
        await sleep(backoffMs(attempt));
      }
    }
  }) as FetchLike;

  Object.defineProperty(wrapped, RETRY_MARKER, { value: true });
  return wrapped;
}

let installed = false;

/**
 * Install the retry wrapper on the driver's global fetch hook. Idempotent, and
 * safe to call before every client creation (that is how `db()` calls it).
 */
export function installFetchRetry(): void {
  if (installed) return;
  installed = true;

  const configured = neonConfig.fetchFunction as FetchLike | undefined;
  if (configured && Object.prototype.hasOwnProperty.call(configured, RETRY_MARKER)) {
    return;
  }

  // Resolve `fetch` at call time, not now — nothing else should be pinned by
  // our wrapper (test doubles, tracing, a future Bun implementation).
  const base: FetchLike = configured ?? ((...args: FetchArgs) => fetch(...args));
  neonConfig.fetchFunction = createRetryingFetch(base);
}
