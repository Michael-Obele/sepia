/**
 * OAuth 2.1 + PKCE authorization server via @tmcp/auth, mounted in the same
 * Bun.serve process as /mcp and /api/*.
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
 * - Multi-tenant: the login page authenticates against Better Auth
 *   (src/auth.ts). Codes and tokens carry the user id; clients are bound to
 *   their authorizing user (an "AI connection", plan-checked). Legacy
 *   DASHBOARD_PASSWORD still authenticates as the admin (self-host compat).
 * - OAuth is enabled when BETTER_AUTH_SECRET is set; otherwise the
 *   endpoints 404 and the server stays bearer-token only.
 */

import { OAuth, InvalidTokenError, InvalidGrantError } from "@tmcp/auth";
import { createHash } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "./db.ts";
import {
  assertAiConnectionQuota,
  getUserById,
  oauthClients,
  oauthCodes,
  oauthTokens,
} from "@sepia/shared";
import { ensureAdmin, verifyCredentials } from "./auth.ts";

/**
 * Normalize /authorize params so real-world clients (Grok, ChatGPT, …) don't
 * trip the library's strict valibot literals — which throw a non-OAuthError
 * and surface as a 500 `server_error` instead of a 400.
 *
 * Fixes:
 * - `response_type` → ALWAYS set to `code` (the login form doesn't include
 *   it, and the library's schema requires it — missing → 500)
 * - `code_challenge_method` → forced to `S256` (case-insensitive); a `plain`
 *   challenge is UPGRADED by hashing it, so the library's S256 verification
 *   still passes when the client sends verifier == challenge at /token
 * - `resource` → dropped if empty or not a valid URL (the login form sends
 *   `resource=""` when the client didn't include it — empty → 500)
 * - `redirect_uri` → dropped if empty or not a valid URL (the library falls
 *   back to the client's single registered redirect URI)
 */
function normalizeAuthorizeUrl(url: URL): URL {
  const out = new URL(url.href);
  const params = out.searchParams;

  // Always force response_type=code — the login form posts without it.
  params.set("response_type", "code");

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
  } else {
    // Empty string (login form sends resource="" when absent) → drop.
    params.delete("resource");
  }

  const redirectUri = params.get("redirect_uri");
  if (redirectUri) {
    try {
      new URL(redirectUri);
    } catch {
      params.delete("redirect_uri");
    }
  } else {
    params.delete("redirect_uri");
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

/** OAuth is live when Better Auth is configured (multi-tenant accounts). */
export function oauthEnabled(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET);
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

/**
 * Fetch + validate a Client ID Metadata Document (RFC 9728 / MCP spec) for a
 * URL-based client_id (ChatGPT, Gemini, Grok all use these).
 *
 * We handle this OURSELVES (instead of letting @tmcp/auth fetch it) because
 * the library's schema REJECTS documents whose token_endpoint_auth_method is
 * "private_key_jwt" — which ChatGPT/Gemini advertise. The library can't
 * verify private_key_jwt anyway, and those clients also support "none", so
 * we normalize the auth method to "none" (the token endpoint then accepts
 * their requests without a secret).
 *
 * Security: we still enforce the spec's requirements — the document's
 * client_id must match the URL exactly, redirect_uris must be present, and
 * shared-secret auth (client_secret) is rejected.
 */
async function fetchClientMetadata(
  clientId: string,
): Promise<OAuthClientInformationFull | undefined> {
  try {
    const url = new URL(clientId);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && url.hostname === "localhost")) ||
      url.username ||
      url.password ||
      url.hash ||
      !url.pathname ||
      url.pathname === "/"
    ) {
      return undefined;
    }
    const res = await fetch(clientId);
    if (!res.ok) return undefined;
    const doc = (await res.json()) as Record<string, unknown>;

    // Spec requirements.
    if (doc.client_id !== clientId) return undefined;
    if (
      !Array.isArray(doc.redirect_uris) ||
      doc.redirect_uris.length === 0 ||
      !doc.redirect_uris.every((u) => typeof u === "string" && isUrl(u))
    ) {
      return undefined;
    }
    if ("client_secret" in doc || "client_secret_expires_at" in doc) {
      return undefined; // metadata documents can't use shared secrets
    }

    return {
      client_id: clientId,
      client_name:
        typeof doc.client_name === "string" && doc.client_name
          ? doc.client_name
          : clientId,
      redirect_uris: doc.redirect_uris as string[],
      // Normalize: the library only supports 'none' (private_key_jwt is
      // unimplemented); ChatGPT/Gemini advertise both.
      token_endpoint_auth_method: "none",
    };
  } catch {
    return undefined;
  }
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const clientStore = {
  async getClient(clientId: string) {
    // 1. DB-registered clients (dynamic client registration).
    const rows = await db()
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId));
    const row = rows[0];
    if (row) {
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
    }

    // 2. URL-based clients (Client ID Metadata Documents) — fetch + sanitize
    //    ourselves so the library's strict schema doesn't reject them.
    if (clientId.startsWith("https://") || clientId.startsWith("http://")) {
      return fetchClientMetadata(clientId);
    }

    return undefined;
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
  // Hidden fields round-trip the OAuth params through the POST. response_type
  // is REQUIRED by the library's schema — the form must include it (the
  // browser posts to /authorize with no query string). resource is only
  // included when present (an empty value would 500 the library).
  const hidden: Array<[string, string]> = [
    ["response_type", "code"],
    ["client_id", client.client_id],
    ["redirect_uri", redirectUri],
    ["code_challenge", codeChallenge ?? ""],
    ["code_challenge_method", "S256"],
    ["state", state ?? ""],
    ["scope", (scopes ?? []).join(" ")],
  ];
  if (resource) hidden.push(["resource", resource.href]);
  const hiddenHtml = hidden
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
  input[type="email"], input[type="password"] {
    width: 100%;
    background: #0b0b10;
    border: 1px solid #2e2e3a;
    color: #e7e5e4;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 15px;
    outline: none;
  }
  input[type="email"]:focus, input[type="password"]:focus { border-color: #8b5cf6; }
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
    <label for="email">Email</label>
    <input type="email" id="email" name="email" autocomplete="email" autofocus required />
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required />
    ${errorHtml}
    ${hiddenHtml}
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

/**
 * Internal header set by handleOAuthRequest() after the credentials are
 * validated (the library consumes the form body before our handler runs, so
 * validation happens in the request pipeline). The rebuilt request strips
 * all client-supplied headers, so this can't be spoofed.
 */
const AUTHENTICATED_HEADER = "x-sepia-oauth-authenticated";
/** Carries the authenticated user id (set alongside AUTHENTICATED_HEADER). */
const AUTHENTICATED_USER_HEADER = "x-sepia-oauth-user";

/**
 * Bind an OAuth client to its authorizing user (an "AI connection").
 * URL-based clients (ChatGPT/Grok/Gemini) are upserted into oauth_clients
 * so the plan limit can count them uniformly. Returns true if the client
 * was already owned by this user.
 */
async function bindClientOwner(
  client: OAuthClientInformationFull,
  userId: string,
): Promise<boolean> {
  const sql = db();
  const existing = await sql
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, client.client_id))
    .limit(1);
  if (existing[0]) {
    if (!existing[0].ownerId) {
      await sql
        .update(oauthClients)
        .set({ ownerId: userId })
        .where(eq(oauthClients.clientId, client.client_id));
    }
    return String(existing[0].ownerId) === userId;
  }
  await sql
    .insert(oauthClients)
    .values({
      clientId: client.client_id,
      clientSecret: client.client_secret ?? null,
      name: client.client_name ?? "MCP client",
      redirectUris: client.redirect_uris ?? [],
      tokenEndpointAuthMethod: client.token_endpoint_auth_method ?? "none",
      ownerId: userId,
    })
    .onConflictDoNothing();
  return false;
}

/** Render a plan-limit page (AI connection quota exceeded). */
function renderPlanLimitPage(client: OAuthClientInformationFull): Response {
  const name = escapeHtml(client.client_name ?? client.client_id);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sepia — Plan limit reached</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0b0b10; color: #e7e5e4; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .card {
    background: #14141c; border: 1px solid #26262f; border-radius: 16px;
    padding: 32px; width: 100%; max-width: 420px;
    box-shadow: 0 20px 60px rgba(0,0,0,.5);
  }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
  p { color: #a8a29e; font-size: 14px; margin-top: 12px; line-height: 1.5; }
  a {
    display: inline-block; margin-top: 20px; background: #8b5cf6; color: white;
    text-decoration: none; border-radius: 10px; padding: 11px 16px;
    font-size: 15px; font-weight: 600;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>Plan limit reached</h1>
    <p>Your free plan allows 1 AI connection, and <b>${name}</b> would be a new one. Upgrade to Pro for unlimited connections — or disconnect an existing AI in your dashboard first.</p>
    <a href="https://sepia.svelte-apps.me/pricing">See pricing</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const handlers = {
  /**
   * GET  → render the login + consent page (form posts back to /authorize).
   * POST → the credentials were already validated by handleOAuthRequest()
   *        (it rebuilds the request and sets AUTHENTICATED_HEADER). Bind the
   *        client to the user (AI connection, plan-checked), issue a
   *        PKCE-bound code carrying the user id, redirect.
   */
  async authorize(
    authReq: AuthorizeRequest,
    httpReq: Request,
  ): Promise<Response> {
    const { client, redirectUri, codeChallenge, state, scopes, resource } =
      authReq;

    if (httpReq.method === "POST") {
      if (httpReq.headers.get(AUTHENTICATED_HEADER) !== "1") {
        return renderLoginPage({
          client,
          redirectUri,
          codeChallenge,
          state,
          scopes,
          resource,
          error: "Incorrect email or password. Try again.",
        });
      }

      const userId = httpReq.headers.get(AUTHENTICATED_USER_HEADER) ?? "";
      if (!userId) {
        return renderLoginPage({
          client,
          redirectUri,
          codeChallenge,
          state,
          scopes,
          resource,
          error: "Sign-in failed. Try again.",
        });
      }

      // AI connection: bind the client to the user, plan-checked.
      const alreadyOwned = await bindClientOwner(client, userId);
      if (!alreadyOwned) {
        const user = await getUserById(db(), userId);
        try {
          await assertAiConnectionQuota(db(), userId, user?.plan);
        } catch {
          return renderPlanLimitPage(client);
        }
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
          userId,
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

      return issueTokens(
        row.clientId,
        row.scopes,
        row.userId ? String(row.userId) : undefined,
      );
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
    return issueTokens(
      row.clientId,
      row.scopes,
      row.userId ? String(row.userId) : undefined,
    );
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
      // The account that authorized the token (multi-tenant).
      extra: row.userId ? { userId: String(row.userId) } : undefined,
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
  userId?: string,
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
      userId: userId ?? null,
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

// ── Request pipeline (single entry point for the fetch handler) ────────────

/**
 * Rewrite a request URL to the public issuer origin so the OAuth library's
 * origin check passes behind Fly's TLS termination (Bun sees http://
 * internally while the issuer is https://sepia.fly.dev). Path + query are
 * preserved; the body/headers are untouched.
 */
function publicOauthRequest(request: Request): Request {
  const url = new URL(request.url);
  const issuer = new URL(issuerUrl());
  if (url.origin === issuer.origin) return request;
  const publicUrl = new URL(issuer.origin);
  publicUrl.pathname = url.pathname;
  publicUrl.search = url.search;
  return new Request(publicUrl.href, request);
}

/**
 * Handle an incoming HTTP request for the OAuth endpoints. Returns a Response
 * for OAuth routes (/authorize, /token, /register, /revoke, /.well-known/*),
 * or null for everything else (routing continues in the fetch handler).
 * Returns null when OAuth is disabled.
 *
 * The pipeline (each step fixes a real-world client bug):
 * 1. Origin rewrite — Fly's TLS proxy means Bun sees http:// while the
 *    issuer is https://sepia.fly.dev; the library rejects origin mismatches.
 * 2. POST /authorize — the library consumes the form body before our handler
 *    runs, so the password is validated HERE; the request is rebuilt without
 *    the password (and without client-supplied headers) and marked
 *    authenticated via an internal header.
 * 3. Param normalization — real clients send variations (plain PKCE, case
 *    differences, missing response_type, empty resource) that the library's
 *    strict schemas turn into 500s.
 * 4. Error logging — the library swallows non-OAuth errors silently.
 */
export async function handleOAuthRequest(
  request: Request,
): Promise<Response | null> {
  if (!oauthEnabled()) return null;

  const url = new URL(request.url);
  const publicUrl = publicOauthRequest(request);

  try {
    if (url.pathname === "/authorize" && request.method === "POST") {
      const form = await request.formData();
      const email = form.get("email")?.toString() ?? "";
      const password = form.get("password")?.toString() ?? "";
      // Merge the original query params with the form body (minus the
      // credentials), then normalize so client variations don't 500.
      const merged = new URL(publicUrl.url);
      for (const [key, value] of form) {
        if (key !== "email" && key !== "password") {
          merged.searchParams.set(key, value.toString());
        }
      }
      const normalized = normalizeAuthorizeUrl(merged);
      const rebuilt = new Request(normalized.href, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: normalized.searchParams.toString(),
      });
      // Multi-tenant: verify against Better Auth. Legacy fallback: the
      // single DASHBOARD_PASSWORD still authenticates as the admin user
      // (self-hosters who haven't migrated to accounts yet).
      const user = await verifyCredentials(email, password);
      if (user) {
        rebuilt.headers.set(AUTHENTICATED_HEADER, "1");
        rebuilt.headers.set(AUTHENTICATED_USER_HEADER, user.id);
      } else if (
        process.env.DASHBOARD_PASSWORD &&
        password === process.env.DASHBOARD_PASSWORD
      ) {
        const admin = await ensureAdmin();
        rebuilt.headers.set(AUTHENTICATED_HEADER, "1");
        rebuilt.headers.set(AUTHENTICATED_USER_HEADER, admin.id);
      }
      return (await oauth.respond(rebuilt)) ?? null;
    }

    const normalized =
      url.pathname === "/authorize"
        ? new Request(
            normalizeAuthorizeUrl(new URL(publicUrl.url)).href,
            publicUrl,
          )
        : publicUrl;
    return (await oauth.respond(normalized)) ?? null;
  } catch (e) {
    console.error("[oauth] request failed:", e);
    throw e;
  }
}
