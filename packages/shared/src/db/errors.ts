/**
 * Database errors that should surface to the client (MCP tool error, REST
 * error, or dashboard remote-function error) as a structured message.
 */
export class MemoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
  }
}

export function notFound(kind: string, idOrName: string): MemoryError {
  return new MemoryError("not_found", `${kind} '${idOrName}' not found`);
}

/** PostgreSQL SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * The Postgres fields buried under Drizzle's wrapper.
 *
 * Drizzle does NOT rethrow the driver error. It throws a `DrizzleQueryError`
 * whose `cause` is the driver's `NeonDbError` (see drizzle-orm/errors.js), so
 * the SQLSTATE and the violated constraint live on the CAUSE, never on the
 * error the caller catches; reading `error.code` finds nothing. Walk the cause
 * chain for the first object carrying a 5-char SQLSTATE.
 *
 * Without this, a constraint violation reaches the model as Drizzle's raw
 * `Failed query: insert into "entities" …` dump (the 2026-10-11 incident).
 */
export function pgError(
  error: unknown,
): { code: string; constraint?: string; detail?: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") return undefined;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      detail?: unknown;
      cause?: unknown;
    };
    if (
      typeof candidate.code === "string" &&
      /^[0-9A-Z]{5}$/.test(candidate.code)
    ) {
      return {
        code: candidate.code,
        constraint:
          typeof candidate.constraint === "string"
            ? candidate.constraint
            : undefined,
        detail:
          typeof candidate.detail === "string" ? candidate.detail : undefined,
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

/**
 * True when `error` (or a wrapped cause) is a Postgres unique violation.
 *
 * `constraint` is optional on purpose: some drivers omit it, and when the table
 * has a single unique key the SQLSTATE alone is unambiguous.
 */
export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  const pg = pgError(error);
  if (pg?.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || pg.constraint === constraint;
}
