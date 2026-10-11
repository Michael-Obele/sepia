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
import { isUniqueViolation, MemoryError, pgError } from "./errors.ts";

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
