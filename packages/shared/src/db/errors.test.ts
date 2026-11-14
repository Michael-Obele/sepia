/**
 * Unit tests for the Postgres-error unwrapping in `errors.ts`.
 *
 * WHY: Drizzle does not rethrow the driver error. It throws a
 * `DrizzleQueryError` whose `.cause` is the driver error (`NeonDbError`), so
 * `error.code` is `undefined` at the level the caller catches — reading it
 * finds nothing. The 2026-10-11 duplicate-name fix depends on walking that
 * cause chain; these tests pin the walk without needing a database.
 *
 * Verified against the real driver (2026-10-11): a duplicate entity insert
 * throws `DrizzleQueryError` with `code: undefined` and
 * `cause = { code: "23505", constraint: "entities_namespace_id_name_key" }`.
 *
 * Run from the repo root:  bun test
 */
import { describe, expect, test } from "bun:test";
import {
  describeError,
  isPreSendNetworkError,
  isUniqueViolation,
  MemoryError,
  pgError,
} from "./errors.ts";

/** A stand-in for the driver error, carrying only the fields we read. */
function driverError(code: string, constraint?: string) {
  return Object.assign(
    new Error("duplicate key value violates unique constraint"),
    {
      code,
      constraint,
      detail: "Key (namespace_id, name)=(…) already exists.",
    },
  );
}

/** A stand-in for what Drizzle actually throws around the driver error. */
function drizzleWrapped(cause: unknown) {
  const error = new Error('Failed query: insert into "entities" …');
  (error as { cause?: unknown }).cause = cause;
  return error;
}

describe("pgError", () => {
  test("reads the SQLSTATE off the wrapped cause, not the thrown error", () => {
    const wrapped = drizzleWrapped(
      driverError("23505", "entities_namespace_id_name_key"),
    );
    // The trap: the error we catch has no code, so a naive `error.code` fails.
    expect((wrapped as unknown as { code?: string }).code).toBeUndefined();
    expect(pgError(wrapped)).toEqual({
      code: "23505",
      constraint: "entities_namespace_id_name_key",
      detail: "Key (namespace_id, name)=(…) already exists.",
    });
  });

  test("walks a deeper cause chain", () => {
    const wrapped = drizzleWrapped(
      drizzleWrapped(driverError("23505", "entities_namespace_id_name_key")),
    );
    expect(pgError(wrapped)?.code).toBe("23505");
  });

  test("returns undefined for an error with no SQLSTATE anywhere", () => {
    expect(pgError(new Error("boom"))).toBeUndefined();
    expect(pgError("not an error")).toBeUndefined();
    expect(pgError(undefined)).toBeUndefined();
  });

  test("does not mistake a MemoryError for a driver error", () => {
    // MemoryError.code is a word ("not_found"), never a 5-char SQLSTATE.
    expect(
      pgError(new MemoryError("not_found", "namespace 'x' not found")),
    ).toBeUndefined();
  });
});

describe("isUniqueViolation", () => {
  test("true for 23505, and honours the constraint when given", () => {
    const err = drizzleWrapped(
      driverError("23505", "entities_namespace_id_name_key"),
    );
    expect(isUniqueViolation(err)).toBe(true);
    expect(isUniqueViolation(err, "entities_namespace_id_name_key")).toBe(true);
    expect(isUniqueViolation(err, "some_other_key")).toBe(false);
  });

  test("false for non-unique SQLSTATEs", () => {
    const check = drizzleWrapped(
      driverError("23514", "entities_importance_check"),
    );
    const foreignKey = drizzleWrapped(
      driverError("23503", "entities_namespace_id_fkey"),
    );
    expect(isUniqueViolation(check)).toBe(false);
    expect(isUniqueViolation(foreignKey)).toBe(false);
  });

  test("false for a plain error", () => {
    expect(isUniqueViolation(new Error("nope"))).toBe(false);
  });
});

/**
 * The REAL chain a DNS failure produces — verified against
 * `@neondatabase/serverless` 1.1.0 on 2026-11-14:
 *
 *   DrizzleQueryError          (.cause)
 *     -> NeonDbError           (.sourceError — the driver does NOT use .cause)
 *       -> TypeError           (code: EAI_AGAIN)
 *
 * Reading `.cause` twice finds nothing, which is why the app could not see the
 * reason during that incident.
 */
function dnsFailureChain() {
  const syscall = Object.assign(
    new TypeError("getaddrinfo EAI_AGAIN api.c-5.us-east-2.aws.neon.tech"),
    { code: "EAI_AGAIN", errno: -3001, syscall: "getaddrinfo" },
  );
  const driver = Object.assign(
    new Error(`Error connecting to database: ${syscall}`),
    { name: "NeonDbError", code: undefined, sourceError: syscall },
  );
  const drizzle = Object.assign(
    new Error('Failed query: select "users"."id" from "apikey" …'),
    { name: "DrizzleQueryError", cause: driver },
  );
  return drizzle;
}

describe("isPreSendNetworkError", () => {
  test("true for a DNS failure hidden two layers down", () => {
    expect(isPreSendNetworkError(dnsFailureChain())).toBe(true);
  });

  test("true for a raw connect failure", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    expect(isPreSendNetworkError(refused)).toBe(true);
  });

  test("false for a reset after send — it may have been processed", () => {
    // Retrying this class is how a transient blip duplicates a write.
    const reset = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    expect(isPreSendNetworkError(reset)).toBe(false);
  });

  test("false for ordinary errors, MemoryErrors, and non-errors", () => {
    expect(isPreSendNetworkError(new Error("boom"))).toBe(false);
    expect(
      isPreSendNetworkError(new MemoryError("not_found", "x not found")),
    ).toBe(false);
    expect(isPreSendNetworkError(undefined)).toBe(false);
    expect(isPreSendNetworkError("EAI_AGAIN")).toBe(false);
  });
});

describe("describeError", () => {
  test("leads with the root cause, not Drizzle's wrapper", () => {
    const described = describeError(dnsFailureChain());
    expect(described).toContain("getaddrinfo EAI_AGAIN");
    expect(described.indexOf("getaddrinfo")).toBeLessThan(
      described.indexOf("Failed query"),
    );
  });

  test("adds a code the message does not already carry", () => {
    const refused = Object.assign(new Error("connect failed"), {
      code: "ECONNREFUSED",
    });
    expect(describeError(refused)).toBe("Error: connect failed (ECONNREFUSED)");
  });

  test("does not repeat a code the message already contains", () => {
    const error = Object.assign(
      new TypeError("getaddrinfo EAI_AGAIN api.example"),
      { code: "EAI_AGAIN" },
    );
    expect(describeError(error)).toBe(
      "TypeError: getaddrinfo EAI_AGAIN api.example",
    );
  });

  test("truncates a link instead of dumping the whole SQL", () => {
    const described = describeError(new Error("x".repeat(500)));
    expect(described.endsWith("…")).toBe(true);
    expect(described.length).toBeLessThan(250);
  });

  test("handles a thrown non-error", () => {
    expect(describeError("boom")).toBe("boom");
  });
});
