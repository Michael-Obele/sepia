/**
 * OAuth 2.1 smoke test — exercises the FULL flow against a running server:
 * metadata → register → authorize (login page) → token exchange → /mcp + /api.
 *
 * Designed to catch regressions, not just pass:
 * - Simulates the production topology (issuer ≠ request origin) via
 *   EXPECTED_ISSUER — this is what caught the Fly TLS origin-mismatch bug.
 * - Tests the failure paths: wrong password, PKCE mismatch, code reuse,
 *   refresh reuse, wrong secret, spoofed auth header, expired tokens.
 * - Cleans up its own test client + tokens (when DATABASE_URL is set).
 *
 * Usage:
 *   bun run smoke:oauth                                  # local (:8090)
 *   SMOKE_URL=https://sepia.fly.dev bun run smoke:oauth  # against deployed
 *   EXPECTED_ISSUER=https://sepia.fly.dev ...            # issuer ≠ SMOKE_URL origin
 *
 * Env: SMOKE_URL, EXPECTED_ISSUER, DASHBOARD_PASSWORD (required),
 *      MCP_BEARER_TOKEN, DATABASE_URL (enables cleanup + expired-token test)
 */
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db.ts";
import { oauthClients, oauthCodes, oauthTokens } from "@sepia/shared";

const BASE = (process.env.SMOKE_URL ?? "http://localhost:8090").replace(
  /\/$/,
  "",
);
const EXPECTED_ISSUER = (process.env.EXPECTED_ISSUER ?? BASE).replace(
  /\/$/,
  "",
);
const PASSWORD = process.env.DASHBOARD_PASSWORD ?? "";
const STATIC_TOKEN = process.env.MCP_BEARER_TOKEN ?? "test-static-token";
const REDIRECT_URI = "http://localhost:9999/callback";
const hasDb = Boolean(process.env.DATABASE_URL);

if (!PASSWORD) {
  console.error(
    "❌ DASHBOARD_PASSWORD env var is required (the server's consent password).",
  );
  process.exit(1);
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function codeChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

async function mcpCall(token: string | null, id: number, method: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params:
        method === "initialize"
          ? {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "smoke", version: "1" },
            }
          : {},
    }),
  });
  return res;
}

async function main() {
  let clientId = "";
  let exitCode = 1;

  try {
    // 0. Server must be in OAuth mode — hard fail otherwise.
    const root = (await (await fetch(`${BASE}/`)).json()) as { auth: string };
    if (root.auth !== "oauth-2.1") {
      console.error(
        `❌ Server is not in OAuth mode (auth="${root.auth}"). Set DASHBOARD_PASSWORD and redeploy.`,
      );
      process.exit(1);
    }
    check("root reports oauth-2.1", true, root.auth);

    // 1. Authorization server metadata — must match the EXPECTED issuer.
    //    (This is the check that catches the Fly TLS origin-mismatch bug:
    //    a server whose issuer ≠ request origin 404s here.)
    const metaRes = await fetch(
      `${BASE}/.well-known/oauth-authorization-server`,
    );
    check(
      "auth-server metadata 200",
      metaRes.status === 200,
      String(metaRes.status),
    );
    if (metaRes.status !== 200) {
      console.error(
        `  💥 metadata returned ${metaRes.status} — server may be behind a TLS proxy without the origin rewrite`,
      );
      failures++;
    } else {
      const meta = (await metaRes.json()) as {
        issuer: string;
        authorization_endpoint: string;
        token_endpoint: string;
        scopes_supported?: string[];
      };
      check(
        "issuer matches expected",
        meta.issuer === `${EXPECTED_ISSUER}/`,
        meta.issuer,
      );
      check(
        "endpoints advertised",
        Boolean(meta.authorization_endpoint && meta.token_endpoint),
      );
      check(
        "scopes advertised",
        Boolean(
          meta.scopes_supported?.includes("memory:read") &&
          meta.scopes_supported?.includes("memory:write"),
        ),
      );
    }

    // 2. Protected resource metadata
    const prm = (await (
      await fetch(`${BASE}/.well-known/oauth-protected-resource`)
    ).json()) as {
      authorization_servers?: string[];
    };
    check(
      "protected-resource metadata",
      Boolean(prm.authorization_servers?.includes(`${EXPECTED_ISSUER}/`)),
    );

    // 3. Dynamic client registration
    const reg = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "smoke-test",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "none",
      }),
    });
    const client = (await reg.json()) as {
      client_id: string;
      client_secret?: string;
    };
    clientId = client.client_id;
    check(
      "client registered",
      reg.status === 201 && !!client.client_id,
      client.client_id,
    );

    // 4. Authorize GET → login page (with resource param, like Grok sends)
    const verifier = b64url(randomBytes(32));
    const challenge = codeChallenge(verifier);
    const authUrl = new URL(`${BASE}/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", client.client_id);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", "test-state-123");
    authUrl.searchParams.set("scope", "memory:read memory:write");
    authUrl.searchParams.set("resource", `${EXPECTED_ISSUER}/`);
    const page = await fetch(authUrl);
    const html = await page.text();
    check(
      "login page renders",
      page.status === 200 &&
        html.includes("Sepia — Authorize access") &&
        html.includes("smoke-test"),
    );
    check(
      "login page has hidden fields",
      html.includes('name="code_challenge"') &&
        html.includes('name="state"') &&
        html.includes('name="response_type"'),
    );
    check("login page doesn't echo password", !html.includes(PASSWORD));

    // 4b. REGRESSION: real-world client variations must NOT 500.
    //     (Bug: @tmcp/auth's strict valibot literals turned these into
    //     `server_error` 500s — Grok hit this on /authorize. The server
    //     normalizes them; each must return 200 with the login page.)
    const variations: Array<[string, string, string]> = [
      ["code_challenge_method=plain", "code_challenge_method", "plain"],
      [
        "code_challenge_method=s256 (lowercase)",
        "code_challenge_method",
        "s256",
      ],
      ["code_challenge_method=PLAIN", "code_challenge_method", "PLAIN"],
      ["response_type=Code", "response_type", "Code"],
      ["response_type=token", "response_type", "token"],
      ["resource without scheme", "resource", "sepia.fly.dev/mcp"],
    ];
    for (const [label, key, value] of variations) {
      const vUrl = new URL(`${BASE}/authorize`);
      vUrl.searchParams.set("response_type", "code");
      vUrl.searchParams.set("client_id", client.client_id);
      vUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      vUrl.searchParams.set("code_challenge", challenge);
      vUrl.searchParams.set("code_challenge_method", "S256");
      vUrl.searchParams.set(key, value);
      const vRes = await fetch(vUrl);
      const vHtml = await vRes.text();
      check(
        `variation not 500: ${label}`,
        vRes.status === 200 && vHtml.includes("Sepia — Authorize access"),
        String(vRes.status),
      );
    }

    // 4c. REGRESSION: plain PKCE must work END-TO-END (authorize with
    //     code_challenge_method=plain, then exchange with verifier ==
    //     challenge — the plain convention). The server upgrades plain →
    //     S256 by hashing the challenge, so the library's S256 verification
    //     passes when the client sends verifier == challenge.
    {
      const plainChallenge = "plain-challenge-value-123";
      const plainUrl = new URL(`${BASE}/authorize`);
      plainUrl.searchParams.set("response_type", "code");
      plainUrl.searchParams.set("client_id", client.client_id);
      plainUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      plainUrl.searchParams.set("code_challenge", plainChallenge);
      plainUrl.searchParams.set("code_challenge_method", "plain");
      const plainPage = await fetch(plainUrl);
      check(
        "plain PKCE authorize 200",
        plainPage.status === 200,
        String(plainPage.status),
      );

      const plainForm = new URLSearchParams();
      // NOTE: no response_type — the real login form doesn't send it.
      plainForm.set("client_id", client.client_id);
      plainForm.set("redirect_uri", REDIRECT_URI);
      plainForm.set("code_challenge", plainChallenge);
      plainForm.set("code_challenge_method", "plain");
      plainForm.set("password", PASSWORD);
      const plainAuth = await fetch(`${BASE}/authorize`, {
        method: "POST",
        body: plainForm,
        redirect: "manual",
      });
      const plainCode = new URL(
        plainAuth.headers.get("location") ?? "",
      ).searchParams.get("code");
      check(
        "plain PKCE authorize redirects with code",
        plainAuth.status === 302 && !!plainCode,
        String(plainAuth.status),
      );

      const plainTokenForm = new URLSearchParams();
      plainTokenForm.set("grant_type", "authorization_code");
      plainTokenForm.set("client_id", client.client_id);
      plainTokenForm.set("code", plainCode ?? "");
      plainTokenForm.set("redirect_uri", REDIRECT_URI);
      plainTokenForm.set("code_verifier", plainChallenge);
      const plainTokenRes = await fetch(`${BASE}/token`, {
        method: "POST",
        body: plainTokenForm,
      });
      const plainTokens = (await plainTokenRes.json()) as {
        access_token?: string;
      };
      check(
        "plain PKCE token exchange succeeds",
        plainTokenRes.status === 200 && !!plainTokens.access_token,
        String(plainTokenRes.status),
      );
    }

    // 5. Authorize POST with wrong password → error page, no redirect.
    //    NOTE: no response_type — the real login form doesn't send it.
    const formWrong = new URLSearchParams();
    formWrong.set("client_id", client.client_id);
    formWrong.set("redirect_uri", REDIRECT_URI);
    formWrong.set("code_challenge", challenge);
    formWrong.set("code_challenge_method", "S256");
    formWrong.set("state", "test-state-123");
    formWrong.set("scope", "memory:read memory:write");
    formWrong.set("password", "wrong-password");
    const wrongRes = await fetch(`${BASE}/authorize`, {
      method: "POST",
      body: formWrong,
      redirect: "manual",
    });
    const wrongHtml = await wrongRes.text();
    check(
      "wrong password rejected",
      wrongRes.status === 200 &&
        wrongHtml.includes("Incorrect password") &&
        !wrongRes.headers.get("location"),
    );

    // 6. Spoofed auth header without password → must NOT redirect
    const spoofForm = new URLSearchParams(formWrong);
    spoofForm.delete("password");
    const spoofRes = await fetch(`${BASE}/authorize`, {
      method: "POST",
      headers: { "x-sepia-oauth-authenticated": "1" },
      body: spoofForm,
      redirect: "manual",
    });
    const spoofHtml = await spoofRes.text();
    check(
      "spoofed auth header rejected",
      spoofRes.status === 200 &&
        spoofHtml.includes("Sepia — Authorize access") &&
        !spoofRes.headers.get("location"),
    );

    // 7. Authorize POST with correct password → 302 + code
    const form = new URLSearchParams(formWrong);
    form.set("password", PASSWORD);
    form.set("resource", `${EXPECTED_ISSUER}/`);
    const authRes = await fetch(`${BASE}/authorize`, {
      method: "POST",
      body: form,
      redirect: "manual",
    });
    const location = authRes.headers.get("location") ?? "";
    const code = new URL(location).searchParams.get("code");
    const state = new URL(location).searchParams.get("state");
    check(
      "authorize redirects with code",
      authRes.status === 302 && !!code,
      location,
    );
    check("state round-trips", state === "test-state-123");

    // 8. PKCE failure: wrong verifier → 400, and the code must NOT be consumed
    const badTokenForm = new URLSearchParams();
    badTokenForm.set("grant_type", "authorization_code");
    badTokenForm.set("client_id", client.client_id);
    badTokenForm.set("code", code!);
    badTokenForm.set("redirect_uri", REDIRECT_URI);
    badTokenForm.set(
      "code_verifier",
      "wrong-verifier-wrong-verifier-wrong-verifier",
    );
    const badTokenRes = await fetch(`${BASE}/token`, {
      method: "POST",
      body: badTokenForm,
    });
    check(
      "PKCE wrong verifier rejected",
      badTokenRes.status === 400,
      String(badTokenRes.status),
    );

    // 9. Token exchange with the CORRECT verifier → still works (code not consumed)
    const tokenForm = new URLSearchParams();
    tokenForm.set("grant_type", "authorization_code");
    tokenForm.set("client_id", client.client_id);
    tokenForm.set("code", code!);
    tokenForm.set("redirect_uri", REDIRECT_URI);
    tokenForm.set("code_verifier", verifier);
    tokenForm.set("resource", `${EXPECTED_ISSUER}/`);
    const tokenRes = await fetch(`${BASE}/token`, {
      method: "POST",
      body: tokenForm,
    });
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      scope: string;
    };
    check(
      "token exchange succeeds after PKCE failure",
      tokenRes.status === 200 &&
        !!tokens.access_token &&
        !!tokens.refresh_token,
      tokens.token_type,
    );
    check("token has scopes", tokens.scope === "memory:read memory:write");

    // 10. Code is single-use
    const reuse = await fetch(`${BASE}/token`, {
      method: "POST",
      body: tokenForm,
    });
    check("code reuse rejected", reuse.status === 400, String(reuse.status));

    // 11. /mcp with OAuth access token (Streamable HTTP returns SSE)
    const mcpRes = await mcpCall(tokens.access_token, 1, "initialize");
    check(
      "MCP initialize with OAuth token",
      mcpRes.status === 200,
      String(mcpRes.status),
    );
    const initText = await mcpRes.text();
    const initData =
      initText
        .split("\n")
        .find((l) => l.startsWith("data: "))
        ?.slice(6) ?? "{}";
    const init = JSON.parse(initData) as {
      result?: { serverInfo?: { name?: string } };
    };
    check(
      "MCP server info",
      init.result?.serverInfo?.name === "sepia",
      init.result?.serverInfo?.name,
    );

    // 12. /api/* with OAuth token (dual-mode auth applies here too)
    const apiRes = await fetch(`${BASE}/api/namespaces`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    check("API with OAuth token", apiRes.status === 200, String(apiRes.status));

    // 13. /mcp with static bearer token (dual mode)
    const mcpStatic = await mcpCall(STATIC_TOKEN, 2, "tools/list");
    check(
      "MCP tools/list with static token",
      mcpStatic.status === 200,
      String(mcpStatic.status),
    );

    // 14. /mcp without token → 401 + resource_metadata
    const mcpNoAuth = await mcpCall(null, 3, "tools/list");
    check(
      "MCP without token → 401",
      mcpNoAuth.status === 401,
      String(mcpNoAuth.status),
    );
    check(
      "401 advertises resource_metadata",
      (mcpNoAuth.headers.get("www-authenticate") ?? "").includes(
        "oauth-protected-resource",
      ),
    );

    // 15. Refresh token rotation
    const refreshForm = new URLSearchParams();
    refreshForm.set("grant_type", "refresh_token");
    refreshForm.set("client_id", client.client_id);
    refreshForm.set("refresh_token", tokens.refresh_token);
    const refreshRes = await fetch(`${BASE}/token`, {
      method: "POST",
      body: refreshForm,
    });
    const refreshed = (await refreshRes.json()) as {
      access_token: string;
      refresh_token: string;
    };
    check(
      "refresh token rotates",
      refreshRes.status === 200 &&
        !!refreshed.access_token &&
        refreshed.refresh_token !== tokens.refresh_token,
    );

    // 16. Old refresh token must be dead after rotation
    const oldRefreshRes = await fetch(`${BASE}/token`, {
      method: "POST",
      body: refreshForm,
    });
    check(
      "old refresh token rejected after rotation",
      oldRefreshRes.status === 400,
      String(oldRefreshRes.status),
    );

    // 17. Old access token revoked by rotation
    const mcpOld = await mcpCall(tokens.access_token, 4, "tools/list");
    check(
      "old access token revoked after rotation",
      mcpOld.status === 401,
      String(mcpOld.status),
    );

    // 18. Revoke with wrong secret → rejected
    const badRevokeForm = new URLSearchParams();
    badRevokeForm.set("client_id", client.client_id);
    badRevokeForm.set("client_secret", "wrong-secret");
    badRevokeForm.set("token", refreshed.access_token);
    const badRevokeRes = await fetch(`${BASE}/revoke`, {
      method: "POST",
      body: badRevokeForm,
    });
    check(
      "revoke with wrong secret rejected",
      badRevokeRes.status === 401,
      String(badRevokeRes.status),
    );

    // 19. Revoke with correct secret → 200, token dead
    const revokeForm = new URLSearchParams();
    revokeForm.set("client_id", client.client_id);
    revokeForm.set("client_secret", client.client_secret ?? "");
    revokeForm.set("token", refreshed.access_token);
    const revokeRes = await fetch(`${BASE}/revoke`, {
      method: "POST",
      body: revokeForm,
    });
    check(
      "revoke succeeds",
      revokeRes.status === 200,
      String(revokeRes.status),
    );
    const mcpRevoked = await mcpCall(refreshed.access_token, 5, "tools/list");
    check(
      "revoked token rejected",
      mcpRevoked.status === 401,
      String(mcpRevoked.status),
    );

    // 20. Expired token rejected (DB-backed; skipped without DATABASE_URL)
    if (hasDb) {
      const expiredToken = `expired-${randomBytes(8).toString("hex")}`;
      await db()
        .insert(oauthTokens)
        .values({
          accessToken: expiredToken,
          refreshToken: `expired-refresh-${randomBytes(8).toString("hex")}`,
          clientId: client.client_id,
          scopes: ["memory:read"],
          expiresAt: new Date(Date.now() - 1000),
          refreshExpiresAt: new Date(Date.now() + 1000),
        });
      const mcpExpired = await mcpCall(expiredToken, 6, "tools/list");
      check(
        "expired token rejected",
        mcpExpired.status === 401,
        String(mcpExpired.status),
      );
    } else {
      console.log("  ⏭️  expired-token test skipped (set DATABASE_URL)");
    }

    console.log(
      failures === 0 ? "\n🎉 ALL PASSED" : `\n💥 ${failures} FAILURES`,
    );
    exitCode = failures === 0 ? 0 : 1;
  } finally {
    // Self-cleanup: remove the test client + its codes/tokens.
    // NOTE: must run BEFORE process.exit() — exit() skips finally blocks.
    if (hasDb && clientId) {
      await db().delete(oauthTokens).where(eq(oauthTokens.clientId, clientId));
      await db().delete(oauthCodes).where(eq(oauthCodes.clientId, clientId));
      await db()
        .delete(oauthClients)
        .where(eq(oauthClients.clientId, clientId));
      console.log("🧹 cleaned up test client + tokens");
    }
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("💥 smoke test crashed:", e);
  process.exit(1);
});
