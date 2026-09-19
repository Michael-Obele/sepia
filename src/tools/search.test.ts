/**
 * MCP tool-surface test for `search`.
 *
 * WHY THIS EXISTS: the library tests prove the matching engine, but the original
 * requirement named the MCP surface specifically ("especially the mcp too"). Until
 * this file, nothing would fail if `src/tools/search.ts` forgot to spread `terms`
 * / `partial` into the tool result — the only end-to-end check was `scripts/smoke.ts`,
 * which needs a running server.
 *
 * The tool is registered against a stub server that captures the handler, so the
 * real registration + handler code runs with no transport and no server process.
 *
 * SAFETY: fixtures live under `tool-suite+<run>@sepia.test` and are deleted in
 * `afterAll` (cascade). Without DATABASE_URL the file skips.
 *
 * Run from the repo root:  bun test
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test as bunTest,
} from "bun:test";
import { and, inArray, like, lt } from "drizzle-orm";
import type { McpServer } from "tmcp";
import { memories, namespaces, users } from "@sepia/shared";
import { db } from "../db.ts";
import { registerSearchTools } from "./search.ts";

const hasDb = Boolean(process.env.DATABASE_URL);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = `tool-suite+${RUN}@sepia.test`;
const NS = `tool-suite-${RUN}`;
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

const test = (name: string, fn: () => void | Promise<unknown>) =>
  bunTest(name, fn, TEST_TIMEOUT_MS);

interface ToolResult {
  count: number;
  terms: string[];
  partial: boolean;
  hits: Array<{ matched_terms: number; kind: string }>;
}

describe.skipIf(!hasDb)("search MCP tool", () => {
  let ownerId = "";
  let definition: { name?: string; description?: string } | undefined;
  let handler:
    | ((args: Record<string, unknown>) => Promise<unknown>)
    | undefined;

  /** Raw text of a tmcp tool result (JSON for success, a message for errors). */
  async function rawText(args: Record<string, unknown>): Promise<string> {
    if (!handler) throw new Error("the search tool was never registered");
    const result = (await handler(args)) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const block = result.content?.find((c) => c.type === "text");
    return block?.text ?? "";
  }

  async function call(args: Record<string, unknown>): Promise<ToolResult> {
    return JSON.parse(await rawText(args)) as ToolResult;
  }

  beforeAll(async () => {
    const conn = db();

    await conn
      .delete(users)
      .where(
        and(
          like(users.email, "tool-suite%@sepia.test"),
          lt(users.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );

    const [owner] = await conn
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Tool Suite",
        email: OWNER_EMAIL,
      })
      .returning({ id: users.id });
    ownerId = String(owner!.id);

    const [ns] = await conn
      .insert(namespaces)
      .values({ ownerId, name: NS, description: "test" })
      .returning({ id: namespaces.id });

    await conn.insert(memories).values({
      namespaceId: String(ns!.id),
      content: "cold starts in the deploy pipeline",
      importance: 0.8,
    });

    // Register the REAL tool against a stub that captures the handler; the
    // handler reads the caller from `server.ctx.custom.user`.
    const stub = {
      ctx: { custom: { user: { id: ownerId } } },
      tool(def: { name?: string; description?: string }, fn: typeof handler) {
        definition = def;
        handler = fn;
      },
    } as unknown as McpServer<any, any>;
    registerSearchTools(stub);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!ownerId) return;
    await db()
      .delete(users)
      .where(inArray(users.email, [OWNER_EMAIL]));
  }, SETUP_TIMEOUT_MS);

  test("registers the tool with the coverage contract in its description", () => {
    expect(definition?.name).toBe("search");
    expect(definition?.description).toContain("partial");
  });

  test("a multi-word query with absent words still returns hits", async () => {
    // The reported bug: "deploy pipeline" appear nowhere else, and the old
    // AND-of-words filter returned 0 rows for this.
    const result = await call({
      q: "cold starts missing words",
      namespace: NS,
    });
    expect(result.count).toBeGreaterThan(0);
    expect(result.hits[0]?.kind).toBe("memory");
    expect(result.hits[0]?.matched_terms).toBe(2);
  });

  test("the result carries terms and a truthful partial flag", async () => {
    const partial = await call({
      q: "cold starts missing words",
      namespace: NS,
    });
    expect(partial.terms).toEqual(["cold", "starts", "missing", "words"]);
    expect(partial.partial).toBe(true);

    const full = await call({ q: "deploy pipeline", namespace: NS });
    expect(full.partial).toBe(false);
  });

  test("an unknown namespace surfaces as a tool error, not an empty result", async () => {
    // A typo'd namespace must not read as "no memories exist".
    const text = await rawText({ q: "cold", namespace: "no-such-namespace" });
    expect(text).toContain("namespace_not_found");
  });

  test("an unauthenticated call fails instead of returning data", async () => {
    const unauthenticated = {
      ctx: { custom: {} },
      tool(_def: unknown, fn: typeof handler) {
        handler = fn;
      },
    } as unknown as McpServer<any, any>;
    registerSearchTools(unauthenticated);
    expect(await rawText({ q: "cold" })).toContain("unauthenticated");
  });
});
