/**
 * The HTTP failure boundary. On 2026-11-14 a one-second DNS failure made `Bun.serve`
 * render its dev crash page as the body of a 500, so the MCP client saw a wall of HTML.
 * Rules: a pre-send failure is 503 + Retry-After, not 500 (the input was fine, asking again
 * is the fix); /mcp answers JSON-RPC 2.0 because that is the only shape an MCP client can
 * parse; every other route matches the REST error shape; internal detail goes to the log.
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
 * Response for an error that escaped a handler, logging the real cause in one root-cause-first
 * line. `transientMessage` lets an auth boundary say "authentication unavailable" instead of
 * blaming the database.
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
