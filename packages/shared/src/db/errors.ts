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

/** How far to follow the wrapper chain; also bounds a self-referencing error. */
const MAX_ERROR_CHAIN = 5;

/**
 * Network error codes that guarantee the request never reached the server —
 * DNS never resolved, or the TCP connection was refused/never established.
 * Retrying these is safe even for writes, because nothing was executed.
 *
 * Deliberately NOT here: `ECONNRESET`, `ECONNABORTED`, `EPIPE`, and timeouts
 * that can fire AFTER the request is on the wire. Those may have been
 * processed, so a retry could apply a write twice. See `db/retry.ts`.
 */
const PRE_SEND_NETWORK_CODES: ReadonlySet<string> = new Set([
  "EAI_AGAIN", // DNS temporary failure — the 2026-11-14 incident
  "EAI_NODATA", // DNS answered "no such data"
  "ENOTFOUND", // DNS NXDOMAIN
  "ECONNREFUSED", // nothing listening; the connection never opened
  "UND_ERR_CONNECT_TIMEOUT", // undici: connect phase timed out, nothing sent
]);

/**
 * Walk an error and everything it wraps, outermost first.
 *
 * Three shapes are in play, and reaching the real reason needs all of them:
 *   - Drizzle nests the driver error on `.cause` (`DrizzleQueryError`);
 *   - `@neondatabase/serverless` puts the failed `fetch` on `.sourceError`
 *     (verified against 1.1.0 — it does NOT set `.cause`);
 *   - undici/Bun put the syscall error on `.cause` of `TypeError: fetch failed`.
 *
 * Reading only `.cause` stops at the driver wrapper, which is exactly why the
 * 2026-11-14 DNS failure was invisible to the app and only legible in Bun's
 * crash page.
 */
function errorChain(
  error: unknown,
  limit = MAX_ERROR_CHAIN,
): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let current: unknown = error;
  while (
    typeof current === "object" &&
    current !== null &&
    chain.length < limit
  ) {
    const link = current as Record<string, unknown>;
    chain.push(link);
    current = link.cause ?? link.sourceError;
  }
  return chain;
}

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
  for (const candidate of errorChain(error)) {
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

/**
 * True when the request never left the machine — a DNS or connect failure.
 *
 * These are transient by definition, safe to retry (see `db/retry.ts`), and
 * never the caller's fault — which is why they must not be reported as a 401
 * or as a failed query.
 */
export function isPreSendNetworkError(error: unknown): boolean {
  return errorChain(error).some(
    (candidate) =>
      typeof candidate.code === "string" &&
      PRE_SEND_NETWORK_CODES.has(candidate.code),
  );
}

/** Longest single link kept by `describeError` (Drizzle's message carries SQL). */
const MAX_ERROR_PART_CHARS = 200;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * One loggable line describing an error and what it wraps, ROOT CAUSE FIRST.
 *
 * `error.message` alone is useless for a database failure: Drizzle replaces the
 * reason with the opaque `Failed query: select …` wrapper and hides the cause
 * on `.cause`. During the 2026-11-14 incident the real reason
 * (`getaddrinfo EAI_AGAIN …`) existed ONLY in Bun's crash page, because
 * nothing in the app ever walked the chain.
 */
export function describeError(error: unknown): string {
  const parts = errorChain(error).map((candidate) => {
    const name = typeof candidate.name === "string" ? candidate.name : "Error";
    const message =
      typeof candidate.message === "string" ? candidate.message : "";
    const code = typeof candidate.code === "string" ? candidate.code : "";
    const suffix = code && !message.includes(code) ? ` (${code})` : "";
    const text = message || "(no message)";
    return truncate(`${name}: ${text}${suffix}`, MAX_ERROR_PART_CHARS);
  });

  if (parts.length === 0) return String(error);
  // Innermost first — Drizzle's own message is the wrapper, not the reason.
  return parts.reverse().join(" <- ");
}
