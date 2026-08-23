/**
 * Phase 2 authentication: OAuth 2.1 + PKCE authorization server via
 * @tmcp/auth, mounted in the same Bun.serve process as /mcp and /api/*.
 *
 * Endpoints served (auto-routed by `oauth.respond()`):
 *   GET/POST /authorize                          → login + consent page
 *   POST     /token                              → code/refresh exchange
 *   POST     /register                           → dynamic client registration
 *   POST     /revoke                             → token revocation
 *   GET      /.well-known/oauth-authorization-server
 *   GET      /.well-known/oauth-protected-resource
 *
 * Design notes:
 * - Codes and tokens live in Postgres (not memory) so they survive Fly's
 *   scale-to-zero restarts — web AIs (Grok, ChatGPT, Gemini) don't need to
 *   re-authorize after the VM cold-starts.
 * - Access tokens are opaque random strings (no JWT, no OAUTH_JWK_SECRET
 *   needed). Refresh tokens rotate on every use.
 * - The login page authenticates with DASHBOARD_PASSWORD (single user).
 *   The `authenticate()` function is the swap point for the future
 *   multi-account phase (passkeys / TOTP).
 * - OAuth is enabled when DASHBOARD_PASSWORD is set; otherwise the
 *   endpoints 404 and the server stays Phase 1 (bearer token only).
 */

import { OAuth, InvalidTokenError, InvalidGrantError } from "@tmcp/auth";
import { createHash } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "./db.ts";
import { oauthClients, oauthCodes, oauthTokens } from "@sepia/shared";

/**
 * Normalize /authorize params so real-world clients (Grok, ChatGPT, …) don't
 * trip the library's strict valibot literals — which throw a non-OAuthError
 * and surface as a 500 `server_error` instead of a 400.
 *
 * Fixes:
 * - `response_type` → forced to `code` (case-insensitive)
 * - `code_challenge_method` → forced to `S256` (case-insensitive); a `plain`
 *   challenge is UPGRADED by hashing it, so the library's S256 verification
 *   still passes when the client sends verifier == challenge at /token
 * - `resource` → dropped if not a valid URL (optional param)
 * - `redirect_uri` → dropped if not a valid URL (the library falls back to
 *   the client's single registered redirect URI)
 */
export function normalizeAuthorizeUrl(url: URL): URL {
  const out = new URL(url.href);
  const params = out.searchParams;

  if (params.get("response_type")) {
    params.set("response_type", "code");
  }

  const method = params.get("code_challenge_method");
  if (method) {
    if (method.toLowerCase() === "plain") {
      const challenge = params.get("code_challenge");
      if (challenge) {
        // Upgrade plain → S256: store sha256(challenge) so the library's
        // verifyChallenge(verifier, stored) passes when the client sends
        // code_verifier == code_challenge (the plain convention).
        const hashed = createHash("sha256")
          .update(challenge)
          .digest("base64url");
        params.set("code_challenge", hashed);
      }
    }
    params.set("code_challenge_method", "S256");
  }

  const resource = params.get("resource");
  if (resource) {
    try {
      new URL(resource);
    } catch {
      params.delete("resource");
    }
  }

  const redirectUri = params.get("redirect_uri");
  if (redirectUri) {
    try {
      new URL(redirectUri);
    } catch {
      params.delete("redirect_uri");
    }
  }

  return out;
}

export const SCOPES = ["memory:read", "memory:write"] as const;

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Local types (mirror @tmcp/auth's JSDoc types, which aren't exported) ────

interface OAuthClientInformationFull {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  software_id?: string;
  software_version?: string;
}

interface AuthorizeRequest {
  client: OAuthClientInformationFull;
  redirectUri: string;
  codeChallenge?: string;
  state?: string;
  scopes?: string[];
  resource?: URL;
}

interface ExchangeAuthorizationCodeRequest {
  client: OAuthClientInformationFull;
  type: "authorization_code";
  code: string;
  verifier?: string;
  redirectUri?: string;
  scopes?: string[];
  resource?: URL;
}

interface ExchangeRefreshTokenRequest {
  client: OAuthClientInformationFull;
  type: "refresh_token";
  refreshToken: string;
  scopes?: string[];
  resource?: URL;
}

type ExchangeRequest =
  | ExchangeAuthorizationCodeRequest
  | ExchangeRefreshTokenRequest;

interface OAuthTokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  resource?: URL;
  extra?: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** OAuth is live when the dashboard password is set (single-user login). */
export function oauthEnabled(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

function issuerUrl(): string {
  return process.env.OAUTH_ISSUER_URL ?? "https://sepia.fly.dev";
}

/** URL-safe random token (base64url, no padding). */
function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Client store (DB-backed, survives restarts) ────────────────────────────

const clientStore = {
  async getClient(clientId: string) {
    const rows = await db()
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId));
    const row = rows[0];
    if (!row) return undefined;
    return {
      client_id: row.clientId,
      client_secret: row.clientSecret ?? undefined,
      redirect_uris: row.redirectUris,
      client_name: row.name,
      token_endpoint_auth_method: row.tokenEndpointAuthMethod ?? undefined,
      client_id_issued_at: row.createdAt
        ? Math.floor(new Date(row.createdAt).getTime() / 1000)
        : undefined,
    };
  },
  async registerClient(
    client: Omit<
      OAuthClientInformationFull,
      "client_id" | "client_id_issued_at"
    >,
  ) {
    const clientId = crypto.randomUUID();
    await db()
      .insert(oauthClients)
      .values({
        clientId,
        clientSecret: client.client_secret ?? null,
        name: client.client_name ?? "MCP client",
        redirectUris: client.redirect_uris ?? [],
        tokenEndpointAuthMethod: client.token_endpoint_auth_method ?? "none",
      });
    return { ...client, client_id: clientId };
  },
};

// ── Login + consent page ────────────────────────────────────────────────────

interface LoginPageOptions {
  client: OAuthClientInformationFull;
  redirectUri: string;
  codeChallenge?: string;
  state?: string;
  scopes?: string[];
  resource?: URL;
  error?: string;
}

function clientHostname(client: OAuthClientInformationFull): string {
  try {
    return new URL(client.client_id).hostname;
  } catch {
    return client.client_uri
      ? new URL(client.client_uri).hostname
      : "unknown client";
  }
}

function renderLoginPage(opts: LoginPageOptions): Response {
  const { client, redirectUri, codeChallenge, state, scopes, resource, error } =
    opts;
  const name = escapeHtml(client.client_name ?? client.client_id);
  const host = escapeHtml(clientHostname(client));
  const redirectHost = escapeHtml(new URL(redirectUri).hostname);
  const scopeList = (scopes ?? [])
    .map((s) => `<li><code>${escapeHtml(s)}</code></li>`)
    .join("");
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const hidden = (
    [
      ["client_id", client.client_id],
      ["redirect_uri", redirectUri],
      ["code_challenge", codeChallenge ?? ""],
      ["code_challenge_method", "S256"],
      ["state", state ?? ""],
      ["scope", (scopes ?? []).join(" ")],
      ["resource", resource?.href ?? ""],
    ] as const
  )
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`,
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sepia — Authorize access</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0b0b10;
    color: #e7e5e4;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #14141c;
    border: 1px solid #26262f;
    border-radius: 16px;
    padding: 32px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 20px 60px rgba(0,0,0,.5);
  }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
  .sub { color: #a8a29e; font-size: 13px; margin-top: 4px; }
  .client { margin-top: 20px; padding: 12px 14px; background: #1a1a24; border-radius: 10px; font-size: 14px; }
  .client b { display: block; font-size: 15px; }
  .client span { color: #a8a29e; font-size: 12px; }
  .scopes { margin-top: 16px; }
  .scopes p { font-size: 12px; color: #a8a29e; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
  .scopes ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .scopes code { background: #1a1a24; border: 1px solid #26262f; padding: 3px 8px; border-radius: 6px; font-size: 12px; }
  label { display: block; font-size: 13px; color: #a8a29e; margin: 18px 0 6px; }
  input[type="password"] {
    width: 100%;
    background: #0b0b10;
    border: 1px solid #2e2e3a;
    color: #e7e5e4;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 15px;
    outline: none;
  }
  input[type="password"]:focus { border-color: #8b5cf6; }
  button {
    width: 100%;
    margin-top: 18px;
    background: #8b5cf6;
    color: white;
    border: none;
    border-radius: 10px;
    padding: 11px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: #7c4ce0; }
  .error { margin-top: 14px; color: #f87171; font-size: 13px; }
  .redirect { margin-top: 16px; font-size: 12px; color: #78716c; }
</style>
</head>
<body>
  <form class="card" method="post" action="/authorize">
    <h1>Sepia — Authorize access</h1>
    <p class="sub">A memory server is requesting access to your knowledge graph.</p>
    <div class="client">
      <b>${name}</b>
      <span>${host} · redirects to ${redirectHost}</span>
    </div>
    <div class="scopes">
      <p>Requested access</p>
      <ul>${scopeList}</ul>
    </div>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" autofocus required />
    ${errorHtml}
    ${hidden}
    <button type="submit">Authorize</button>
    <p class="redirect">You'll be redirected back to ${redirectHost} after signing in.</p>
  </form>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// ── Handlers ────────────────────────────────────────────────────────────────

const handlers = {
  /**
   * GET  → render the login + consent page (form posts back to /authorize).
   * POST → the password was already validated by the interceptor in
   *        src/index.ts (it rebuilds the request and sets
   *        x-sepia-oauth-authenticated). Issue a PKCE-bound code, redirect.
   */
  async authorize(
    authReq: AuthorizeRequest,
    httpReq: Request,
  ): Promise<Response> {
    const { client, redirectUri, codeChallenge, state, scopes, resource } =
      authReq;

    if (httpReq.method === "POST") {
      if (httpReq.headers.get("x-sepia-oauth-authenticated") !== "1") {
        return renderLoginPage({
          client,
          redirectUri,
          codeChallenge,
          state,
          scopes,
          resource,
          error: "Incorrect password. Try again.",
        });
      }

      const code = randomToken(48);
      await db()
        .insert(oauthCodes)
        .values({
          code,
          clientId: client.client_id,
          redirectUri,
          codeChallenge: codeChallenge ?? null,
          scopes: scopes ?? [],
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        });

      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      if (state) redirect.searchParams.set("state", state);
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirect.toString(),
          "Cache-Control": "no-store",
        },
      });
    }

    return renderLoginPage({
      client,
      redirectUri,
      codeChallenge,
      state,
      scopes,
      resource,
    });
  },

  /** Exchange an authorization code or refresh token for fresh tokens. */
  async exchange(req: ExchangeRequest): Promise<OAuthTokens> {
    if (req.type === "authorization_code") {
      const rows = await db()
        .select()
        .from(oauthCodes)
        .where(eq(oauthCodes.code, req.code));
      const row = rows[0];
      if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
        throw new InvalidGrantError("Invalid authorization code");
      }
      if (row.clientId !== req.client.client_id) {
        throw new InvalidGrantError("Client mismatch");
      }
      if (row.redirectUri !== req.redirectUri) {
        throw new InvalidGrantError("Redirect URI mismatch");
      }
      // Single-use: consume the code.
      await db()
        .update(oauthCodes)
        .set({ consumedAt: new Date() })
        .where(eq(oauthCodes.code, req.code));

      return issueTokens(row.clientId, row.scopes);
    }

    // refresh_token grant — rotate both tokens.
    const rows = await db()
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.refreshToken, req.refreshToken));
    const row = rows[0];
    if (!row || row.revokedAt || row.refreshExpiresAt.getTime() < Date.now()) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    if (row.clientId !== req.client.client_id) {
      throw new InvalidGrantError("Client mismatch");
    }
    await db()
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthTokens.refreshToken, req.refreshToken));
    return issueTokens(row.clientId, row.scopes);
  },

  /** Verify an access token (used by requireAuth for /mcp and /api/*). */
  async verify(token: string): Promise<AuthInfo> {
    const rows = await db()
      .select()
      .from(oauthTokens)
      .where(
        and(eq(oauthTokens.accessToken, token), isNull(oauthTokens.revokedAt)),
      );
    const row = rows[0];
    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new InvalidTokenError("Invalid access token");
    }
    return {
      token,
      clientId: row.clientId,
      scopes: row.scopes,
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
    };
  },

  /** Revoke an access or refresh token. */
  async revoke(
    _client: OAuthClientInformationFull,
    data: { token: string; tokenType?: string },
  ): Promise<void> {
    const now = new Date();
    if (data.tokenType === "refresh_token") {
      await db()
        .update(oauthTokens)
        .set({ revokedAt: now })
        .where(eq(oauthTokens.refreshToken, data.token));
    } else {
      await db()
        .update(oauthTokens)
        .set({ revokedAt: now })
        .where(eq(oauthTokens.accessToken, data.token));
    }
  },
};

async function issueTokens(
  clientId: string,
  scopes: string[],
): Promise<OAuthTokens> {
  const accessToken = randomToken(48);
  const refreshToken = randomToken(48);
  await db()
    .insert(oauthTokens)
    .values({
      accessToken,
      refreshToken,
      clientId,
      scopes,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  };
}

// ── Provider ────────────────────────────────────────────────────────────────

export const oauth = OAuth.issuer(issuerUrl())
  .scopes(...SCOPES)
  .clients(clientStore)
  .handlers(handlers)
  // PKCE is enforced: the retriever returns the code challenge stored at
  // authorize time so /token can verify the code_verifier (S256).
  .pkce(async (_client, code) => {
    const rows = await db()
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.code, code));
    return rows[0]?.codeChallenge ?? "";
  })
  .registration(true)
  .rateLimit({
    "/authorize": { windowMs: 15 * 60 * 1000, max: 100 },
    "/token": { windowMs: 15 * 60 * 1000, max: 50 },
    "/register": { windowMs: 60 * 60 * 1000, max: 20 },
  })
  .build();
