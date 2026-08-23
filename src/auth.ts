/**
 * Authentication for /mcp and /api/* — dual mode:
 *   Phase 1: static Bearer token via the MCP_BEARER_TOKEN env var.
 *   Phase 2: OAuth 2.1 access tokens issued by the built-in authorization
 *            server (src/oauth.ts). Both are accepted; bearer-token clients
 *            (Claude Code, Cursor, Zed, Copilot) keep working unchanged.
 *
 * When MCP_BEARER_TOKEN is unset the server runs in DEV MODE (no auth) —
 * never deploy without setting it.
 */

import { oauth, oauthEnabled } from "./oauth.ts";

export async function requireAuth(request: Request): Promise<Response | null> {
  const expected = process.env.MCP_BEARER_TOKEN;
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token) {
    // Phase 1: static token.
    if (expected && token === expected) return null;
    // Phase 2: OAuth-issued token (verify throws on invalid tokens).
    if (oauthEnabled()) {
      try {
        const info = await oauth.verify(request);
        if (info) return null;
      } catch {
        // Not an OAuth token — fall through to 401.
      }
    }
  }
  const wwwAuth = oauthEnabled()
    ? 'Bearer realm="sepia", resource_metadata="' +
      (process.env.OAUTH_ISSUER_URL ?? "https://sepia.fly.dev") +
      '/.well-known/oauth-protected-resource"'
    : 'Bearer realm="sepia"';
  return Response.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: { "WWW-Authenticate": wwwAuth },
    },
  );
}

export function authEnabled(): boolean {
  return Boolean(process.env.MCP_BEARER_TOKEN);
}
