/**
 * Retry the one class of database failure where retrying is PROVABLY safe:
 * the request never left the machine.
 *
 * THE INCIDENT (2026-11-14): a local Docker container lost DNS for about a
 * second — `getaddrinfo EAI_AGAIN api.c-5.us-east-2.aws.neon.tech` — one
 * `/mcp` POST failed, and the editor's MCP client got an HTML 500 because
 * nothing anywhere retried. That container's log holds 72 such DNS failures
 * across 12 separate days. A data layer that gets exactly one attempt per
 * request cannot survive a resolver that is right 99.9% of the time.
 *
 * WHY `fetch` IS THE RIGHT CHOKE POINT: every query, `db.batch()`, and
 * transaction the Neon HTTP driver runs is ONE HTTP POST, so wrapping `fetch`
 * covers the entire data layer — MCP, REST, and the dashboard — without
 * touching a single call site, and it also covers connection failures that
 * happen before Drizzle is involved at all.
 *
 * WHY THIS CANNOT DOUBLE-WRITE: only failures that guarantee the request was
 * never sent are retried (`isPreSendNetworkError` — DNS never resolved, or TCP
 * refused/no listener). A reset or timeout AFTER send is never retried: at that
 * point the server may already have committed, and a second attempt could
 * apply the write twice. Keep that distinction — a "retry everything" version
 * of this file would turn a blip into duplicated memories.
 *
 * Verified against `@neondatabase/serverless` 1.1.0 (2026-11-14): the driver
 * reads `neonConfig.fetchFunction` and calls it with the same arguments as
 * native `fetch`, so this hooks in without patching the driver.
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
