/**
 * Unit tests for the pre-send retry in `retry.ts`.
 *
 * WHY: the 2026-11-14 incident was a ~1 second DNS failure that failed a whole
 * `/mcp` request, because the data layer got exactly one attempt per query.
 * These tests pin BOTH halves of the contract:
 *   - a DNS/connect failure is retried, and the request recovers;
 *   - a failure that MAY have reached the server is NOT retried, because a
 *     second attempt could apply a write twice.
 *
 * No database is involved — `fetch` is injected, so this is a pure unit test.
 *
 * Run from the repo root:  bun test
 */
import { afterEach, describe, expect, test } from "bun:test";
import { neonConfig } from "@neondatabase/serverless";
import {
  createRetryingFetch,
  installFetchRetry,
  RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
} from "./retry.ts";

/** The error Bun raises when DNS fails — shape verified 2026-11-14. */
function dnsFailure() {
  return Object.assign(
    new TypeError("getaddrinfo EAI_AGAIN api.c-5.us-east-2.aws.neon.tech"),
    { code: "EAI_AGAIN", errno: -3001, syscall: "getaddrinfo" },
  );
}

/** What the driver posts: a re-readable JSON string body. */
const DRIVER_ARGS = [
  "https://api.c-5.us-east-2.aws.neon.tech/sql",
  { method: "POST", body: '{"query":"select 1"}' },
] as unknown as Parameters<typeof fetch>;

function ok(): Response {
  return new Response("{}", { status: 200 });
}

describe("createRetryingFetch", () => {
  test("retries a DNS failure and returns the attempt that succeeds", async () => {
    let calls = 0;
    const retrying = createRetryingFetch(async () => {
      calls += 1;
      if (calls < RETRY_ATTEMPTS) throw dnsFailure();
      return ok();
    });

    const response = await retrying(...DRIVER_ARGS);

    expect(response.status).toBe(200);
    expect(calls).toBe(RETRY_ATTEMPTS);
  });

  test("gives up after RETRY_ATTEMPTS, rethrowing the network error", async () => {
    let calls = 0;
    const startedAt = Date.now();
    const retrying = createRetryingFetch(async () => {
      calls += 1;
      throw dnsFailure();
    });

    await expect(retrying(...DRIVER_ARGS)).rejects.toThrow("EAI_AGAIN");
    expect(calls).toBe(RETRY_ATTEMPTS);
    // Backoff, not a busy spin: retries are spaced out.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(RETRY_BASE_DELAY_MS);
  });

  test("does NOT retry a failure that may have reached the server", async () => {
    // ECONNRESET can fire after the request was sent and possibly committed.
    // Retrying it is how a transient blip becomes a duplicated write.
    let calls = 0;
    const retrying = createRetryingFetch(async () => {
      calls += 1;
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    });

    await expect(retrying(...DRIVER_ARGS)).rejects.toThrow("socket hang up");
    expect(calls).toBe(1);
  });

  test("does not retry an ordinary error", async () => {
    let calls = 0;
    const retrying = createRetryingFetch(async () => {
      calls += 1;
      throw new Error("boom");
    });

    await expect(retrying(...DRIVER_ARGS)).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });

  test("finds the syscall error under a wrapping cause chain", async () => {
    // Node/undici put the code on `.cause` of `TypeError: fetch failed`.
    // Neon then wraps THAT in NeonDbError.sourceError (see errors.ts).
    let calls = 0;
    const retrying = createRetryingFetch(async () => {
      calls += 1;
      if (calls < RETRY_ATTEMPTS) {
        const syscall = dnsFailure();
        const driver = new Error(`Error connecting to database: ${syscall}`);
        (driver as { sourceError?: unknown }).sourceError = syscall;
        const drizzle = new Error("Failed query: select 1");
        (drizzle as { cause?: unknown }).cause = driver;
        throw drizzle;
      }
      return ok();
    });

    const response = await retrying(...DRIVER_ARGS);

    expect(response.status).toBe(200);
    expect(calls).toBe(RETRY_ATTEMPTS);
  });

  test("refuses to replay a streamed body", async () => {
    // A stream can only be read once: re-sending it would post an EMPTY body.
    let calls = 0;
    const retrying = createRetryingFetch(async () => {
      calls += 1;
      throw dnsFailure();
    });
    const streamed = [
      "https://api.c-5.us-east-2.aws.neon.tech/sql",
      { method: "POST", body: new ReadableStream() },
    ] as unknown as Parameters<typeof fetch>;

    await expect(retrying(...streamed)).rejects.toThrow("EAI_AGAIN");
    expect(calls).toBe(1);
  });
});

describe("installFetchRetry", () => {
  const original = neonConfig.fetchFunction;

  afterEach(() => {
    neonConfig.fetchFunction = original;
  });

  test("a second install never stacks a second retry layer", () => {
    // Nine attempts instead of three would be a silent, costly regression:
    // every real outage would take ~2s longer per query.
    installFetchRetry();
    const installed = neonConfig.fetchFunction;
    installFetchRetry();
    expect(neonConfig.fetchFunction).toBe(installed);
  });

  test("adopts an existing retrying fetch instead of wrapping it again", () => {
    // This is the hot-reload shape: a fresh module scope (flag false) meeting
    // a hook that is already retrying. The marker, not the flag, decides.
    const alreadyRetrying = createRetryingFetch(async () => ok());
    neonConfig.fetchFunction = alreadyRetrying;

    installFetchRetry();

    expect(neonConfig.fetchFunction).toBe(alreadyRetrying);
  });
});
