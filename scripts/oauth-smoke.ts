/**
 * OAuth smoke test — exercises the full flow against a local server:
 * metadata → register → authorize (login page) → token exchange → /mcp.
 * Run: bun run scripts/oauth-smoke.ts (server must be running)
 */
import { createHash, randomBytes } from "node:crypto";

const BASE = "http://localhost:8090";
const PASSWORD = "dev-password-123";
const STATIC_TOKEN = process.env.MCP_BEARER_TOKEN ?? "test-static-token";

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

async function main() {
  // 1. Root reports oauth-2.1
  const root = (await (await fetch(`${BASE}/`)).json()) as { auth: string };
  check("root reports oauth-2.1", root.auth === "oauth-2.1", root.auth);

  // 2. Authorization server metadata
  const meta = (await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()) as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    scopes_supported?: string[];
  };
  check("auth-server metadata", meta.issuer === "http://localhost:8090/" && !!meta.authorization_endpoint && !!meta.token_endpoint);
  check("scopes advertised", Boolean(meta.scopes_supported?.includes("memory:read") && meta.scopes_supported?.includes("memory:write")));

  // 3. Protected resource metadata
  const prm = (await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json()) as {
    authorization_servers?: string[];
  };
  check("protected-resource metadata", Boolean(prm.authorization_servers?.includes("http://localhost:8090/")));

  // 4. Dynamic client registration
  const reg = await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "smoke-test",
      redirect_uris: ["http://localhost:9999/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    }),
  });
  const client = (await reg.json()) as {
    client_id: string;
    client_secret?: string;
  };
  check("client registered", reg.status === 201 && !!client.client_id, client.client_id);

  // 5. Authorize GET → login page
  const verifier = b64url(randomBytes(32));
  const challenge = codeChallenge(verifier);
  const authUrl = new URL(`${BASE}/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", "http://localhost:9999/callback");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", "test-state-123");
  authUrl.searchParams.set("scope", "memory:read memory:write");
  const page = await fetch(authUrl);
  const html = await page.text();
  check("login page renders", page.status === 200 && html.includes("Sepia — Authorize access") && html.includes("smoke-test"));
  check("login page has hidden fields", html.includes('name="code_challenge"') && html.includes('name="state"'));

  // 6. Authorize POST with wrong password → error page
  const formWrong = new URLSearchParams();
  formWrong.set("response_type", "code");
  formWrong.set("client_id", client.client_id);
  formWrong.set("redirect_uri", "http://localhost:9999/callback");
  formWrong.set("code_challenge", challenge);
  formWrong.set("code_challenge_method", "S256");
  formWrong.set("state", "test-state-123");
  formWrong.set("scope", "memory:read memory:write");
  formWrong.set("password", "wrong-password");
  const wrongRes = await fetch(`${BASE}/authorize`, { method: "POST", body: formWrong, redirect: "manual" });
  const wrongHtml = await wrongRes.text();
  check("wrong password rejected", wrongRes.status === 200 && wrongHtml.includes("Incorrect password"));

  // 7. Authorize POST with correct password → 302 + code
  const form = new URLSearchParams(formWrong);
  form.set("password", PASSWORD);
  const authRes = await fetch(`${BASE}/authorize`, { method: "POST", body: form, redirect: "manual" });
  const location = authRes.headers.get("location") ?? "";
  const code = new URL(location).searchParams.get("code");
  const state = new URL(location).searchParams.get("state");
  check("authorize redirects with code", authRes.status === 302 && !!code, location);
  check("state round-trips", state === "test-state-123");

  // 8. Token exchange (authorization_code + PKCE)
  const tokenForm = new URLSearchParams();
  tokenForm.set("grant_type", "authorization_code");
  tokenForm.set("client_id", client.client_id);
  tokenForm.set("code", code!);
  tokenForm.set("redirect_uri", "http://localhost:9999/callback");
  tokenForm.set("code_verifier", verifier);
  const tokenRes = await fetch(`${BASE}/token`, { method: "POST", body: tokenForm });
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    scope: string;
  };
  check("token exchange succeeds", tokenRes.status === 200 && !!tokens.access_token && !!tokens.refresh_token, tokens.token_type);
  check("token has scopes", tokens.scope === "memory:read memory:write");

  // 9. Code is single-use
  const reuse = await fetch(`${BASE}/token`, { method: "POST", body: tokenForm });
  check("code reuse rejected", reuse.status === 400, String(reuse.status));

  // 10. /mcp with OAuth access token (Streamable HTTP returns SSE)
  const mcpRes = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } }),
  });
  check("MCP initialize with OAuth token", mcpRes.status === 200, String(mcpRes.status));
  const initText = await mcpRes.text();
  const initData = initText.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? "{}";
  const init = JSON.parse(initData);
  check("MCP server info", init.result?.serverInfo?.name === "sepia", init.result?.serverInfo?.name);

  // 11. /mcp with static bearer token (dual mode)
  const mcpStatic = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${STATIC_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  check("MCP tools/list with static token", mcpStatic.status === 200, String(mcpStatic.status));

  // 12. /mcp without token → 401
  const mcpNoAuth = await fetch(`${BASE}/mcp`, { method: "POST", body: "{}" });
  check("MCP without token → 401", mcpNoAuth.status === 401, String(mcpNoAuth.status));
  check("401 advertises resource_metadata", (mcpNoAuth.headers.get("www-authenticate") ?? "").includes("oauth-protected-resource"));

  // 13. Refresh token rotation
  const refreshForm = new URLSearchParams();
  refreshForm.set("grant_type", "refresh_token");
  refreshForm.set("client_id", client.client_id);
  refreshForm.set("refresh_token", tokens.refresh_token);
  const refreshRes = await fetch(`${BASE}/token`, { method: "POST", body: refreshForm });
  const refreshed = (await refreshRes.json()) as {
    access_token: string;
    refresh_token: string;
  };
  check("refresh token rotates", refreshRes.status === 200 && !!refreshed.access_token && refreshed.refresh_token !== tokens.refresh_token);

  // 14. Rotation revokes the old pair (access + refresh share a row)
  const mcpOld = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
  });
  check("old access token revoked after rotation", mcpOld.status === 401, String(mcpOld.status));

  // 15. Revoke (DCR clients authenticate with their client_secret)
  const revokeForm = new URLSearchParams();
  revokeForm.set("client_id", client.client_id);
  revokeForm.set("client_secret", client.client_secret ?? "");
  revokeForm.set("token", refreshed.access_token);
  const revokeRes = await fetch(`${BASE}/revoke`, { method: "POST", body: revokeForm });
  check("revoke succeeds", revokeRes.status === 200, String(revokeRes.status));
  const mcpRevoked = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${refreshed.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }),
  });
  check("revoked token rejected", mcpRevoked.status === 401, String(mcpRevoked.status));

  console.log(failures === 0 ? "\n🎉 ALL PASSED" : `\n💥 ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("💥 smoke test crashed:", e);
  process.exit(1);
});