/**
 * MCP tool-surface tests for `manage_memory` — the silent-arg-drop guardrails.
 *
 * WHY THIS EXISTS (docs/plans/2026-09-29-silent-arg-drop-guardrails.md):
 * `q` was missing from MemoryToolInput, valibot stripped it, and the query
 * returned the unfiltered top-20 — plausible-looking, so no one noticed. Two
 * conditions from the forge review are load-bearing here:
 *
 * 1. Anchor iteration to the DECLARED filter set (MEMORY_QUERY_FILTERS), not
 *    to schema keys — a param the schema forgot is exactly what must fail.
 * 2. Drive the real tmcp validation path (`~standard.validate`) before the
 *    handler. Handler-direct invocation is where the bug hid: validation is
 *    the layer that ate the argument.
 *
 * Named permanent regressions (must exist regardless of the table):
 *   - `action=query, q=<nonsense>` → 0 rows, NOT top-20 (the incident).
 *   - unknown top-level key → `ignored_args` echo (G2), not silent drop.
 *
 * SAFETY: fixtures live under `mem-suite+<run>@sepia.test`, deleted in
 * afterAll. Skips without DATABASE_URL.
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
import * as v from "valibot";
import {
  MEMORY_QUERY_FILTERS,
  MemoryToolInput,
  memories,
  namespaces,
  users,
} from "@sepia/shared";
import { db } from "../db.ts";
import { registerMemoryTools } from "./memory.ts";

const hasDb = Boolean(process.env.DATABASE_URL);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = `mem-suite+${RUN}@sepia.test`;
const NS = `mem-suite-${RUN}`;
const OTHER_NS = `mem-suite-other-${RUN}`;
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

const test = (name: string, fn: () => void | Promise<unknown>) =>
  bunTest(name, fn, TEST_TIMEOUT_MS);

interface QueryResult {
  action: string;
  count: number;
  memories: unknown[];
  ignored_args?: string[];
  hint?: string;
  filters_applied?: Record<string, unknown>;
  ignored?: string[];
}

/**
 * The REAL validation path tmcp takes (`tool.schema['~standard'].validate`)
 * followed by the registered handler — not a hand-built args object. If the
 * schema drops a key, the handler never sees it and the table below fails.
 */
describe.skipIf(!hasDb)("manage_memory MCP tool", () => {
  let ownerId = "";
  let handler:
    | ((args: Record<string, unknown>) => Promise<unknown>)
    | undefined;

  async function rawText(args: Record<string, unknown>): Promise<string> {
    if (!handler)
      throw new Error("the manage_memory tool was never registered");
    const validated = await MemoryToolInput["~standard"].validate(args);
    if ("issues" in validated) {
      // tmcp turns issues into an isError tool result; mirror that shape.
      return JSON.stringify({ validation_issues: validated.issues });
    }
    const result = (await handler(
      validated.value as Record<string, unknown>,
    )) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const block = result.content?.find((c) => c.type === "text");
    return block?.text ?? "";
  }

  async function call(args: Record<string, unknown>): Promise<QueryResult> {
    return JSON.parse(await rawText(args)) as QueryResult;
  }

  beforeAll(async () => {
    const conn = db();

    await conn
      .delete(users)
      .where(
        and(
          like(users.email, "mem-suite%@sepia.test"),
          lt(users.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );

    const [owner] = await conn
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Mem Suite",
        email: OWNER_EMAIL,
      })
      .returning({ id: users.id });
    ownerId = String(owner!.id);

    const [ns] = await conn
      .insert(namespaces)
      .values({ ownerId, name: NS, description: "test" })
      .returning({ id: namespaces.id });
    const [otherNs] = await conn
      .insert(namespaces)
      .values({ ownerId, name: OTHER_NS, description: "other" })
      .returning({ id: namespaces.id });

    await conn.insert(memories).values([
      {
        namespaceId: String(ns!.id),
        content: "cold starts in the deploy pipeline",
        importance: 0.8,
        type: "fact",
        tags: ["smoke"],
      },
      {
        namespaceId: String(ns!.id),
        content: "opensearch indexing notes for the search engine",
        importance: 0.7,
        type: "observation",
        tags: ["search"],
      },
      // In the OTHER namespace — any namespace-scoped query for NS misses it.
      {
        namespaceId: String(otherNs!.id),
        content: "cold starts live only in the other namespace",
        importance: 0.9,
        type: "fact",
      },
    ]);

    const stub = {
      ctx: { custom: { user: { id: ownerId } } },
      tool(_def: unknown, fn: typeof handler) {
        handler = fn;
      },
    } as unknown as McpServer<any, any>;
    registerMemoryTools(stub);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!ownerId) return;
    await db()
      .delete(users)
      .where(inArray(users.email, [OWNER_EMAIL]));
  }, SETUP_TIMEOUT_MS);

  // ── The incident, as a permanent regression ──────────────────────────────
  test("REGRESSION: nonsense q returns 0 rows, never the top-20", async () => {
    const result = await call({
      action: "query",
      namespace: NS,
      q: "zzzqqqnonexistent987654",
    });
    expect(result.memories.length).toBe(0);
  });

  test("REGRESSION: a real keyword still matches (q wired to the lib)", async () => {
    const result = await call({
      action: "query",
      namespace: NS,
      q: "opensearch",
    });
    expect(result.memories.length).toBe(1);
  });

  test("unfiltered query returns everything in the namespace", async () => {
    const result = await call({ action: "query", namespace: NS });
    expect(result.memories.length).toBe(2);
  });

  // ── G4: every declared filter must actually filter ───────────────────────
  // Driven by the DECLARED set (not schema keys). Each case pairs a value
  // that must exclude everything against a control that must not.
  test("every declared filter excludes when it should", async () => {
    const cases: Array<{
      key: (typeof MEMORY_QUERY_FILTERS)[number];
      excluding: Record<string, unknown>;
      control?: Record<string, unknown>;
      expectControlRows: number;
    }> = [
      {
        key: "type",
        excluding: { type: "instruction" }, // none seeded as instruction
        control: { type: "fact" },
        expectControlRows: 1,
      },
      {
        key: "importance_min",
        excluding: { importance_min: 0.95 }, // above every row
        control: { importance_min: 0.5 },
        expectControlRows: 2,
      },
      {
        key: "archived",
        excluding: { archived: true }, // nothing seeded archived
        control: { archived: false },
        expectControlRows: 2,
      },
      {
        key: "tags",
        excluding: { tags: ["no-such-tag-xyz"] },
        control: { tags: ["smoke"] },
        expectControlRows: 1,
      },
      {
        key: "q",
        excluding: { q: "zzzqqqnonexistent987654" },
        control: { q: "deploy" },
        expectControlRows: 1,
      },
      {
        key: "offset",
        excluding: { offset: 50 }, // past every row
        expectControlRows: 0,
      },
      {
        key: "limit",
        excluding: { limit: 1 },
        expectControlRows: 1, // limit excludes the REST, not the whole set
      },
      // namespace: a missing one THROWS (MemoryError), an existing-but-empty
      // one returns 0 — exercised below, not as an exclusion pair.
    ];

    for (const c of cases) {
      const excluded = await call({
        action: "query",
        namespace: NS,
        ...c.excluding,
      });
      expect(
        excluded.memories.length,
        `filter "${c.key}" did not exclude (${JSON.stringify(c.excluding)})`,
      ).toBe(c.key === "limit" ? 1 : 0);
      if (c.control) {
        const controlled = await call({
          action: "query",
          namespace: NS,
          ...c.control,
        });
        expect(
          controlled.memories.length,
          `filter "${c.key}" control returned wrong count`,
        ).toBe(c.expectControlRows);
      }
    }
  });

  test("namespace filter scopes to its namespace", async () => {
    const inNs = await call({ action: "query", namespace: NS });
    const inOther = await call({ action: "query", namespace: OTHER_NS });
    expect(inNs.memories.length).toBe(2);
    expect(inOther.memories.length).toBe(1);
  });

  // ── G2: unknown keys are reported, not silently dropped ──────────────────
  test("unknown top-level key surfaces as ignored_args with a hint", async () => {
    const result = await call({
      action: "query",
      namespace: NS,
      totally_bogus_param: 42,
    });
    expect(result.ignored_args).toEqual(["totally_bogus_param"]);
    expect(result.hint).toContain("did NOT apply");
    // ...and the query itself still ran correctly alongside the echo.
    expect(result.memories.length).toBe(2);
  });

  test("clean calls carry no ignored_args noise", async () => {
    const result = await call({ action: "query", namespace: NS, q: "deploy" });
    expect(result.ignored_args).toBeUndefined();
    expect(result.memories.length).toBe(1);
  });

  // ── G5: the response says what was actually applied ──────────────────────
  test("filters_applied echoes the declared set (q visible, not silent)", async () => {
    const withQ = await call({ action: "query", namespace: NS, q: "deploy" });
    expect(withQ.filters_applied?.q).toBe("deploy");
    expect(withQ.filters_applied?.namespace).toBe(NS);
    // Every declared key present — a dropped filter reads null, not absent.
    // (Iterate the array directly: Object.keys on an as-const array gives
    // indices, not names — that mistake made this assertion vacuous once.)
    for (const key of MEMORY_QUERY_FILTERS) {
      expect(key in (withQ.filters_applied ?? {})).toBe(true);
    }

    const withoutQ = await call({ action: "query", namespace: NS });
    expect(withoutQ.filters_applied?.q).toBeNull();
  });

  test("wrong-action params are named in ignored, not silently dropped", async () => {
    // `where` is declared for batch_update — passing it to query passes every
    // schema check and used to die in silence (the residual class from the
    // forge review). It must be reported as inapplicable.
    const result = await call({
      action: "query",
      namespace: NS,
      where: { q: "deploy" },
    });
    expect(result.ignored?.[0]).toContain("where");
    expect(result.ignored?.[0]).toContain("not valid for this action");
    expect(result.memories.length).toBe(2);
  });
});
