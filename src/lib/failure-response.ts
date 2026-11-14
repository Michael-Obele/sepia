/**
 * The failure boundary for the HTTP process.
 *
 * WHY THIS FILE EXISTS: on 2026-11-14 a one-second DNS failure inside the
 * container made `Bun.serve` render its development crash page as the body of a
 * `500` response. The MCP client could only report `Error 500 status sending
 * message to http://localhost:8484/mcp` followed by a wall of HTML — no JSON,
 * no JSON-RPC error, no usable reason. Nothing was wrong with the request.
 *
 * The rules encoded here:
 *   - A failure that never reached the database (`isPreSendNetworkError`) is
 *     `503` + `Retry-After`, NOT `500`: the caller's input was fine and asking
 *     again is the fix.
 *   - `/mcp` answers in JSON-RPC 2.0, because that is the only error shape an
 *     MCP client can parse and surface.
 *   - Every other route answers `{ error: { code, message } }`, matching the
 *     REST surface in `src/api.ts`.
 *   - Internal detail goes to the LOG, never to the response body — except for
 *     the transient message, which is deliberately safe to show a user.
 */
import { describeError, isPreSendNetworkError } from "@sepia/shared";

/** JSON-RPC 2.0 "internal error" — spec-defined and parseable by every client. */
const JSON_RPC_INTERNAL_ERROR = -32603;

/** Safe to show a caller: nothing ran, and asking again is the fix. */
const TRANSIENT_MESSAGE =
  "database temporarily unreachable — the request did not run; retrying is safe";

/** `/mcp` and anything mounted under it speaks JSON-RPC, not REST. */
function isMcpPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/mcp/");
}

/**
 * Build the response for an error that escaped a route handler, and log the
 * real cause in one line (`describeError` is root-cause-first; `error.message`
 * alone is Drizzle's opaque `Failed query: …` wrapper).
 *
 * `transientMessage` lets an auth boundary say "authentication temporarily
 * unavailable" instead of blaming the database at the caller's level.
 */
export function failureResponse(
  error: unknown,
  pathname: string,
  transientMessage = TRANSIENT_MESSAGE,
): Response {
  const transient = isPreSendNetworkError(error);
  const code = transient ? "database_unreachable" : "internal_error";
  const message = transient ? transientMessage : "internal server error";
  const status = transient ? 503 : 500;

  const headers: Record<string, string> = { "cache-control": "no-store" };
  // The one header that turns a transient failure into a self-healing one.
  if (transient) headers["retry-after"] = "1";

  console.error(
    `[${transient ? "transient" : "error"}] ${pathname}: ${describeError(error)}`,
  );

  if (isMcpPath(pathname)) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: JSON_RPC_INTERNAL_ERROR, message: `${code}: ${message}` },
      },
      { status, headers },
    );
  }
  return Response.json({ error: { code, message } }, { status, headers });
}

/**
 * Wrap a route handler so nothing it throws can reach Bun's HTML crash page.
 * The handler keeps its shape; only the failure path changes.
 */
export function withErrorBoundary(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      return failureResponse(error, new URL(request.url).pathname);
    }
  };
}
