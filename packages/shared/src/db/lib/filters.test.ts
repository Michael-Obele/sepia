/**
 * Read/write filter tests — the sibling `q` paths that are NOT the ranked search
 * engine: `queryMemories`, `findEntities`, and the two destructive `batchUpdate*`
 * filters.
 *
 * WHY THESE EXIST: the reported bug ("multi-word queries return 0 hits") lived in
 * `search()`, but the same single-phrase substring matching sat in four other
 * places. Two of them are DESTRUCTIVE — an unescaped `where: {q: "%"}` becomes the
 * pattern `'%%%'`, which matched every row in the namespace (2320/2320 on the live
 * database) and rewrites up to `batch_limit` of them.
 *
 * SAFETY: same throwaway-owner pattern as search.test.ts — fixtures live under
 * `filter-suite+<run>@sepia.test` and are deleted in `afterAll` (users → namespaces
 * → memories/entities cascade). Without DATABASE_URL the whole file skips.
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
import type { Db } from "../client.ts";
import { db } from "../client.ts";
import { entities, memories, namespaces, users } from "../schema.ts";
import { batchUpdateEntities, findEntities } from "./entities.ts";
import { batchUpdateMemories, queryMemories } from "./memories.ts";

const hasDb = Boolean(process.env.DATABASE_URL);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = `filter-suite+${RUN}@sepia.test`;
const NS = "filter-suite";
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

const test = (name: string, fn: () => void | Promise<unknown>) =>
  bunTest(name, fn, TEST_TIMEOUT_MS);

describe.skipIf(!hasDb)("filters", () => {
  let conn: Db;
  let ownerId = "";
  let nsId = "";
  const ids = new Map<string, string>();

  function id(key: string): string {
    const value = ids.get(key);
    if (!value) throw new Error(`fixture '${key}' was never seeded`);
    return value;
  }

  beforeAll(async () => {
    conn = db();

    // Self-heal only long-dead runs; never another live run's fixtures.
    await conn
      .delete(users)
      .where(
        and(
          like(users.email, "filter-suite%@sepia.test"),
          lt(users.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );

    const [owner] = await conn
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Filter Suite",
        email: OWNER_EMAIL,
      })
      .returning({ id: users.id });
    ownerId = String(owner!.id);

    const [ns] = await conn
      .insert(namespaces)
      .values({ ownerId, name: NS, description: "test" })
      .returning({ id: namespaces.id });
    nsId = String(ns!.id);

    const mems = await conn
      .insert(memories)
      .values([
        {
          namespaceId: nsId,
          content: "Jev prefers Bun over Node",
          importance: 0.9,
        },
        { namespaceId: nsId, content: "Bun only note", importance: 0.5 },
        {
          namespaceId: nsId,
          content: "coverage is 100% done",
          importance: 0.5,
        },
      ])
      .returning({ id: memories.id });
    ["M1", "M2", "M3"].forEach((key, i) => ids.set(key, String(mems[i]!.id)));

    const ents = await conn
      .insert(entities)
      .values([
        {
          namespaceId: nsId,
          name: "Smoke Project",
          type: "project",
          summary: "test",
          importance: 0.9,
        },
        { namespaceId: nsId, name: "100% Tool", type: "tool" },
        { namespaceId: nsId, name: "Other Thing", type: "concept" },
      ])
      .returning({ id: entities.id });
    ["E1", "E2", "E3"].forEach((key, i) => ids.set(key, String(ents[i]!.id)));
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!conn) return;
    await conn.delete(users).where(inArray(users.email, [OWNER_EMAIL]));
  }, SETUP_TIMEOUT_MS);

  // ── Read paths: multi-word must not require adjacency ───────────────────
  test("queryMemories matches the terms in any order", async () => {
    // The old single-phrase substring required "bun jev" to appear verbatim.
    const rows = await queryMemories(conn, ownerId, {
      namespace: NS,
      q: "Bun Jev",
      limit: 50,
    });
    expect(rows.map((r) => String(r.id))).toContain(id("M1"));
  });

  test("queryMemories still matches a single term", async () => {
    const rows = await queryMemories(conn, ownerId, {
      namespace: NS,
      q: "Bun",
      limit: 50,
    });
    const got = rows.map((r) => String(r.id));
    expect(got).toContain(id("M1"));
    expect(got).toContain(id("M2"));
    expect(got).not.toContain(id("M3"));
  });

  test("queryMemories escapes LIKE wildcards", async () => {
    const rows = await queryMemories(conn, ownerId, {
      namespace: NS,
      q: "%",
      limit: 50,
    });
    expect(rows.map((r) => String(r.id))).toEqual([id("M3")]);
  });

  test("findEntities matches the terms in any order", async () => {
    const rows = await findEntities(
      conn,
      ownerId,
      NS,
      "Project Smoke",
      undefined,
      50,
    );
    expect(rows.map((r) => String(r.id))).toContain(id("E1"));
  });

  test("findEntities escapes LIKE wildcards", async () => {
    const rows = await findEntities(conn, ownerId, NS, "%", undefined, 50);
    expect(rows.map((r) => String(r.id))).toEqual([id("E2")]);
  });

  // ── Destructive paths: a wildcard must not select the namespace ─────────
  test("batchUpdateMemories with q='%' touches only the literal match", async () => {
    const { count } = await batchUpdateMemories(
      conn,
      ownerId,
      { namespace: NS, q: "%" },
      { tags: ["escaped"] },
      500,
    );
    expect(count).toBe(1);

    // Prove the other rows were untouched, not merely uncounted.
    const rows = await queryMemories(conn, ownerId, {
      namespace: NS,
      limit: 50,
    });
    const tagged = rows.filter((r) => (r.tags ?? []).includes("escaped"));
    expect(tagged.map((r) => String(r.id))).toEqual([id("M3")]);
  });

  test("batchUpdateEntities with query='%' touches only the literal match", async () => {
    const { count } = await batchUpdateEntities(
      conn,
      ownerId,
      { namespace: NS, query: "%" },
      { tags: ["escaped"] },
      500,
    );
    expect(count).toBe(1);
  });

  test("batch updates still refuse an empty filter", async () => {
    await expect(
      batchUpdateMemories(conn, ownerId, {}, { tags: ["x"] }),
    ).rejects.toThrow();
    await expect(
      batchUpdateEntities(conn, ownerId, {}, { tags: ["x"] }),
    ).rejects.toThrow();
  });
});
