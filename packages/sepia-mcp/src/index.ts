#!/usr/bin/env node
/**
 * sepia-mcp — self-contained MCP server for Sepia.
 *
 * Registers the same 7 tools as the Sepia server, but every tool call is
 * proxied to the Sepia REST API (`SEPIA_URL/api/*`) with `SEPIA_API_KEY`.
 * No database access, no migrations — just a lightweight MCP wrapper.
 *
 * Transports:
 *   - stdio (default) — for `npx sepia-mcp` in MCP clients
 *   - http — `--http` (or `SEPIA_HTTP=1`) serves Streamable HTTP at /mcp on
 *     PORT (default 8080), so it can be self-hosted on Fly.io too.
 *
 * Env:
 *   SEPIA_URL      base URL, default https://sepia.fly.dev
 *   SEPIA_API_KEY  Bearer token (the server's MCP_BEARER_TOKEN / an API key)
 */
import { McpServer } from "tmcp";
import { ValibotJsonSchemaAdapter } from "@tmcp/adapter-valibot";
import { MEMORY_CONTRACT } from "@sepia/shared";
import { SepiaClient } from "./client.ts";
import { registerNamespaceTools } from "./tools/namespace.ts";
import { registerEntityTools } from "./tools/entity.ts";
import { registerRelationTools } from "./tools/relation.ts";
import { registerMemoryTools } from "./tools/memory.ts";
import { registerSearchTools } from "./tools/search.ts";
import { registerTraverseTools } from "./tools/traverse.ts";
import { registerPruneMemoriesTools } from "./tools/prune.ts";

export interface SepiaMcpOptions {
  baseUrl?: string;
  apiKey?: string;
  source?: string;
  transport?: "stdio" | "http";
  port?: number;
}

export function createSepiaServer(opts: SepiaMcpOptions = {}) {
  const baseUrl =
    opts.baseUrl ?? process.env.SEPIA_URL ?? "https://sepia.fly.dev";
  const apiKey = opts.apiKey ?? process.env.SEPIA_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      "SEPIA_API_KEY is required — set it in the environment (the server's MCP_BEARER_TOKEN or an API key).",
    );
  }

  const client = new SepiaClient({
    baseUrl,
    apiKey,
    source: opts.source ?? process.env.SEPIA_SOURCE ?? "sepia-mcp",
  });

  const server = new McpServer(
    {
      name: "sepia",
      version: "1.0.0",
      description:
        "Sepia — personal knowledge-graph memory server (remote REST client). Entities, relations, memories in namespaces, with search, traversal, and consolidation.",
    },
    {
      adapter: new ValibotJsonSchemaAdapter(),
      capabilities: { tools: {} },
      instructions: MEMORY_CONTRACT,
    },
  );

  registerNamespaceTools(server, client);
  registerEntityTools(server, client);
  registerRelationTools(server, client);
  registerMemoryTools(server, client);
  registerSearchTools(server, client);
  registerTraverseTools(server, client);
  registerPruneMemoriesTools(server, client);

  return { server, client };
}

// ── stdio transport ─────────────────────────────────────────────────────────
// tmcp ships HTTP but no stdio transport, so we drive `server.receive` over
// newline-delimited JSON-RPC on stdin/stdout (the MCP stdio framing).
async function startStdio(server: McpServer<any, any>) {
  const readline = (await import("node:readline")).createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  // Track in-flight handlers so we don't exit before an async response lands
  // when stdin reaches EOF (piped input closes immediately after the last line).
  let pending = 0;
  let closed = false;
  const maybeExit = () => {
    if (closed && pending === 0) process.exit(0);
  };
  readline.on("line", (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return; // ignore malformed frames
    }
    pending++;
    void (async () => {
      try {
        const response = await server.receive(message as never, {
          sessionId: "stdio",
          custom: undefined,
        });
        if (response != null) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : String(error);
        process.stderr.write(`[sepia-mcp] ${messageText}\n`);
      } finally {
        pending--;
        maybeExit();
      }
    })();
  });
  readline.on("close", () => {
    closed = true;
    maybeExit();
  });
}

// ── http transport ──────────────────────────────────────────────────────────
async function startHttp(server: McpServer<any, any>, port: number) {
  const { HttpTransport } = await import("@tmcp/transport-http");
  const transport = new HttpTransport(server, { path: "/mcp" });
  const http = await import("node:http");

  http
    .createServer(async (req, res) => {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`,
      );
      if (url.pathname !== "/mcp") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      // Convert Node.js IncomingMessage → standard Request for HttpTransport
      const body = await new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      });
      const request = new Request(url.toString(), {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: body || undefined,
      });
      try {
        const response = await transport.respond(request, {});
        if (response != null) {
          res.writeHead(response.status, Object.fromEntries(response.headers));
          const responseBody = await response.text();
          res.end(responseBody);
        } else {
          res.writeHead(202);
          res.end("no response");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[sepia-mcp] error:", msg);
        res.writeHead(500);
        res.end(msg);
      }
    })
    .listen(port, () => {
      console.error(`[sepia-mcp] HTTP transport listening on :${port}/mcp`);
    });
}

const isHttp =
  process.argv.includes("--http") ||
  process.argv.includes("--http-transport") ||
  process.env.SEPIA_HTTP === "1";

const { server } = createSepiaServer();
if (isHttp) {
  const port = Number(process.env.PORT ?? 8080);
  await startHttp(server, port);
} else {
  startStdio(server);
}
