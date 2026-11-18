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
 * Pre-send network codes only — DNS or connect failures, so nothing reached the server and
 * a retry is safe even for writes. NOT ECONNRESET/EPIPE/timeouts: those can fire after the
 * request is on the wire, so a retry could duplicate a write. See `db/retry.ts`.
 */
const PRE_SEND_NETWORK_CODES: ReadonlySet<string> = new Set([
  "EAI_AGAIN", // DNS temporary failure — the 2026-11-14 incident
  "EAI_NODATA", // DNS answered "no such data"
  "ENOTFOUND", // DNS NXDOMAIN
  "ECONNREFUSED", // nothing listening; the connection never opened
  "UND_ERR_CONNECT_TIMEOUT", // undici: connect phase timed out, nothing sent
]);

/**
 * Walk an error and everything it wraps, outermost first. Three shapes are in play:
 * Drizzle nests on `.cause`, `@neondatabase/serverless` on `.sourceError`, undici on
 * `.cause` of `TypeError: fetch failed`. Reading only `.cause` stops at the driver
 * wrapper — which is why the 2026-11-14 DNS failure was invisible to the app.
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
 * The Postgres fields buried under Drizzle's wrapper. Drizzle rethrows a
 * `DrizzleQueryError` whose CAUSE is the driver error, so SQLSTATE and constraint
 * live there — reading `error.code` finds nothing, and the model gets a raw
 * `Failed query: …` dump instead (the 2026-10-11 incident).
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
 * True when the request never left the machine — transient, safe to retry, never the
 * caller's fault, so it must not surface as a 401 or a failed query.
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
 * One loggable line, ROOT CAUSE FIRST. `error.message` alone is useless for a DB
 * failure: Drizzle hides the reason behind `Failed query: …`, which is why the real
 * `getaddrinfo EAI_AGAIN` existed only in Bun's crash page during the 2026-11-14 outage.
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
