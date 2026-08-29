import { McpServer } from "tmcp";
import { HttpTransport } from "@tmcp/transport-http";
import { ValibotJsonSchemaAdapter } from "@tmcp/adapter-valibot";
import { DOCS_VERSION, type UserRow } from "@sepia/shared";
import { MEMORY_CONTRACT } from "./instructions.ts";
import { auth, authEnabled, ensureAdmin, requireAuth } from "./auth.ts";
import { handleOAuthRequest, oauthEnabled } from "./oauth.ts";
import { handleApi } from "./api.ts";
import { registerNamespaceTools } from "./tools/namespace.ts";
import { registerEntityTools } from "./tools/entity.ts";
import { registerRelationTools } from "./tools/relation.ts";
import { registerMemoryTools } from "./tools/memory.ts";
import { registerSearchTools } from "./tools/search.ts";
import { registerTraverseTools } from "./tools/traverse.ts";
import { registerConsolidateTools } from "./tools/consolidate.ts";
import { API_RATE_LIMIT, MCP_RATE_LIMIT, rateLimit } from "./rate-limit.ts";

// Per-request custom context: the authenticated user. Set by the fetch
// handler (transport.respond(request, { user })) and read by every tool
// via server.ctx.custom — this is the tenant boundary for MCP calls.

/** Origins allowed to call /api/auth/* from the browser (dashboard). */
const AUTH_CORS_ORIGINS = new Set([
  "https://sepia.svelte-apps.me",
  "http://localhost:5173",
  "http://localhost:4173",
]);

function corsHeadersFor(
  origin: string,
  allowed: boolean,
): Record<string, string> {
  if (!allowed) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    // Better Auth's client sends cookies (credentials mode: include).
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

const server = new McpServer(
  {
    name: "sepia",
    version: "1.0.0",
    description:
      "Sepia — personal knowledge-graph memory server: entities, relations, memories in namespaces, with search, traversal, and consolidation.",
  },
  {
    adapter: new ValibotJsonSchemaAdapter(),
    capabilities: { tools: {} },
    // Injected into the model's system prompt by supporting clients —
    // the "remember without being asked" contract.
    instructions: MEMORY_CONTRACT,
  },
).withContext<{ user: UserRow }>();

// The 7 tools.
registerNamespaceTools(server);
registerEntityTools(server);
registerRelationTools(server);
registerMemoryTools(server);
registerSearchTools(server);
registerTraverseTools(server);
registerConsolidateTools(server);

// Streamable HTTP transport mounted at /mcp inside this Bun.serve process.
const transport = new HttpTransport(server, { path: "/mcp" });

const PORT = Number(process.env.PORT ?? 8080);

// ── Skill + installer endpoints ────────────────────────────────────────────
// The bundled Agent Skill (skills/sepia/) is served over HTTP so clients can
// install it without cloning the repo:
//   - GET /skill                    → SKILL.md (works with `npx skills add <url>`)
//   - GET /skill/references/tools.md → per-tool reference
//   - GET /install                  → remote installer script (curl | bash)
//   - GET /instructions/{vscode,cursor,claude,agents}
//                                  → always-on instruction files (skills/sepia/always-on/)
const SKILL_DIR = new URL("../skills/sepia/", import.meta.url);

function serveSkillFile(relPath: string, contentType: string) {
  const file = Bun.file(new URL(relPath, SKILL_DIR));
  if (!file.exists()) return new Response("Not Found", { status: 404 });
  return new Response(file, {
    headers: { "content-type": contentType },
  });
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    // Health check for Fly's optional TCP check (NOT an HTTP smoke check —
    // those confuse Streamable HTTP servers).
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, service: "sepia" });
    }

    // OAuth 2.1 endpoints (/authorize, /token, /register, /revoke,
    // /.well-known/oauth-*) — handled by the built-in authorization server
    // (src/oauth.ts). Returns null for every other path, so routing
    // continues below.
    const oauthResponse = await handleOAuthRequest(request);
    if (oauthResponse) return oauthResponse;

    if (url.pathname === "/") {
      return Response.json({
        name: "sepia",
        version: "1.0.0",
        docs_version: DOCS_VERSION,
        mcp: "/mcp",
        health: "/healthz",
        skill: "/skill",
        install: "/install",
        llms: "/llms.txt",
        instructions: {
          vscode: "/instructions/vscode",
          cursor: "/instructions/cursor",
          claude: "/instructions/claude",
          agents: "/instructions/agents",
          opencode: "/instructions/opencode",
          zed: "/instructions/zed",
        },
        auth: oauthEnabled()
          ? "oauth-2.1"
          : authEnabled()
            ? "bearer-token"
            : "dev-mode (MCP_BEARER_TOKEN not set)",
        tools: 7,
      });
    }

    // /version — the served truth for docs staleness checks. Installed
    // copies (always-on files, skills) carry a stamped version marker;
    // scripts/check-docs-version.ts compares them against this.
    if (url.pathname === "/version") {
      return Response.json({
        name: "sepia",
        version: "1.0.0",
        docs_version: DOCS_VERSION,
        endpoints: {
          mcp: "/mcp",
          llms: "/llms.txt",
          skill: "/skill",
          install: "/install",
          instructions:
            "/instructions/{vscode,cursor,claude,agents,opencode,zed}",
        },
      });
    }

    // llms.txt — the LLM-readable capability overview (llmstxt.org spec).
    // Agents that can't see MCP tool schemas (online chat models, editors
    // without MCP) fetch this to learn everything the server can do.
    if (url.pathname === "/llms.txt") {
      const file = Bun.file(new URL("../llms.txt", import.meta.url));
      if (!file.exists()) return new Response("Not Found", { status: 404 });
      return new Response(file, {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }

    // Skill + installer are public (no auth) — they're static docs.
    if (url.pathname === "/skill") {
      return serveSkillFile("SKILL.md", "text/markdown; charset=utf-8");
    }
    if (url.pathname === "/skill/references/tools.md") {
      return serveSkillFile(
        "references/tools.md",
        "text/markdown; charset=utf-8",
      );
    }
    // Always-on instruction files (the "system prompt" channel — skills are
    // on-demand only; these are injected into EVERY session by the editor's
    // own instruction system). Same contract as the MCP `instructions` field.
    if (url.pathname === "/instructions/vscode") {
      return serveSkillFile(
        "always-on/vscode.instructions.md",
        "text/markdown; charset=utf-8",
      );
    }
    if (url.pathname === "/instructions/cursor") {
      return serveSkillFile(
        "always-on/cursor.mdc",
        "text/markdown; charset=utf-8",
      );
    }
    if (url.pathname === "/instructions/claude") {
      return serveSkillFile(
        "always-on/claude.md",
        "text/markdown; charset=utf-8",
      );
    }
    if (url.pathname === "/instructions/agents") {
      return serveSkillFile(
        "always-on/agents.md",
        "text/markdown; charset=utf-8",
      );
    }
    if (url.pathname === "/instructions/opencode") {
      return serveSkillFile(
        "always-on/opencode.md",
        "text/markdown; charset=utf-8",
      );
    }
    if (url.pathname === "/instructions/zed") {
      return serveSkillFile("always-on/zed.md", "text/markdown; charset=utf-8");
    }
    if (url.pathname === "/install") {
      const script = Bun.file(
        new URL("../scripts/remote-install.sh", import.meta.url),
      );
      if (!script.exists()) return new Response("Not Found", { status: 404 });
      return new Response(script, {
        headers: { "content-type": "text/x-shellscript; charset=utf-8" },
      });
    }

    if (url.pathname.startsWith("/mcp")) {
      const authResult = await requireAuth(request);
      if (authResult instanceof Response) return authResult;
      if (
        !rateLimit(
          `mcp:${authResult.user.id}`,
          MCP_RATE_LIMIT.max,
          MCP_RATE_LIMIT.windowMs,
        )
      ) {
        return Response.json(
          {
            error: "rate_limited",
            message: "too many requests — try again in a minute",
          },
          { status: 429 },
        );
      }
      const response = await transport.respond(request, {
        user: authResult.user,
      });
      return response ?? new Response("Not Found", { status: 404 });
    }

    // Better Auth endpoints (/api/auth/*) — signup, sign-in, sessions,
    // API keys. Public (no bearer auth) — the endpoints authenticate
    // themselves. Mounted before /api/* so handleApi never sees them.
    // CORS: the dashboard (Netlify) calls these from the browser, so add
    // the allowlist headers (Better Auth's trustedOrigins handles CSRF,
    // not CORS).
    if (url.pathname.startsWith("/api/auth")) {
      const origin = request.headers.get("origin") ?? "";
      const allowed = AUTH_CORS_ORIGINS.has(origin);
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeadersFor(origin, allowed),
        });
      }
      const response = await auth.handler(request);
      if (allowed) {
        const headers = new Headers(response.headers);
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Credentials", "true");
        headers.set("Vary", "Origin");
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
      return response;
    }

    // /api/* (dashboard REST) — same process, same auth, CORS allowlist.
    // OPTIONS preflights are answered before auth (browsers don't send the
    // Authorization header on preflight).
    if (url.pathname.startsWith("/api")) {
      if (request.method === "OPTIONS") {
        const response = await handleApi(request, url, null);
        return response ?? new Response("Not Found", { status: 404 });
      }
      const authResult = await requireAuth(request);
      if (authResult instanceof Response) return authResult;
      if (
        !rateLimit(
          `api:${authResult.user.id}`,
          API_RATE_LIMIT.max,
          API_RATE_LIMIT.windowMs,
        )
      ) {
        return Response.json(
          {
            error: "rate_limited",
            message: "too many requests — try again in a minute",
          },
          { status: 429 },
        );
      }
      const response = await handleApi(request, url, authResult.user);
      return response ?? new Response("Not Found", { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
  },
});

// Bootstrap the admin account + adopt pre-tenant data (idempotent).
await ensureAdmin();

console.log(
  `memory MCP server listening on :${PORT} (/mcp) — auth: ${
    authEnabled()
      ? "accounts (Better Auth)"
      : "DEV MODE (set BETTER_AUTH_SECRET)"
  }`,
);
