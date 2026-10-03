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
import {
  batchUpdateEntities,
  entityListQuery,
  findEntities,
  findEntityList,
} from "./entities.ts";
import {
  batchUpdateMemories,
  memoryDetailQuery,
  memoryDigestQuery,
  memoryLinksQuery,
  memoryListQuery,
  queryMemories,
  queryMemoryList,
} from "./memories.ts";
import { namespacesQuery } from "./namespaces.ts";

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

  // ── Lean list reads: the dashboard's projection ─────────────────────────
  // The dashboard list must not pay for the generated BM25 columns — measured
  // 2026-10-02, `haystack_tsv` alone is 45 kB of an 86 kB 50-row payload.
  test("findEntityList drops the tsvector/metadata columns", async () => {
    const rows = await findEntityList(conn, ownerId, {
      namespace: NS,
      limit: 50,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("haystackTsv");
      expect(Object.keys(row)).not.toContain("metadata");
    }
  });

  test("findEntityList returns the same ids in the same order as findEntities", async () => {
    const lean = await findEntityList(conn, ownerId, {
      namespace: NS,
      limit: 50,
    });
    const full = await findEntities(
      conn,
      ownerId,
      NS,
      undefined,
      undefined,
      50,
      0,
    );
    expect(lean.map((r) => String(r.id))).toEqual(
      full.map((r) => String(r.id)),
    );
  });

  test("findEntityList honours the q/type filters the same way", async () => {
    const lean = await findEntityList(conn, ownerId, {
      namespace: NS,
      q: "Project Smoke",
      limit: 50,
    });
    expect(lean.map((r) => String(r.id))).toContain(id("E1"));
  });

  test("findEntityList returns [] for a stale namespace instead of throwing", async () => {
    const rows = await findEntityList(conn, ownerId, {
      namespace: "no-such-namespace",
      limit: 50,
    });
    expect(rows).toEqual([]);
  });

  test("queryMemoryList drops content_tsv but keeps content + namespace", async () => {
    const rows = await queryMemoryList(conn, ownerId, {
      namespace: NS,
      limit: 50,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("contentTsv");
      expect(Object.keys(row)).toContain("content");
      expect(row.namespace).toBe(NS);
    }
  });

  test("queryMemoryList returns the same ids in the same order as queryMemories", async () => {
    const lean = await queryMemoryList(conn, ownerId, {
      namespace: NS,
      limit: 50,
    });
    const full = await queryMemories(conn, ownerId, {
      namespace: NS,
      limit: 50,
    });
    expect(lean.map((r) => String(r.id))).toEqual(
      full.map((r) => String(r.id)),
    );
  });

  // ── The dashboard page shape: ONE HTTP request ──────────────────────────
  // `db.batch` calls `_prepare()` on every element, so the reads must be
  // non-async BUILDERS. This test is what stops someone "helpfully" making
  // `entityListQuery` async and silently turning the page's single round trip
  // back into two (or throwing at runtime, as it did on 2026-10-02).
  test("the entities page composes into ONE db.batch", async () => {
    const [ents, nss] = await conn.batch([
      entityListQuery(conn, ownerId, { namespace: NS, limit: 50 }),
      namespacesQuery(conn, ownerId),
    ]);
    expect(ents.length).toBeGreaterThan(0);
    expect(
      (nss as unknown as { rows: { name: string }[] }).rows.map((r) => r.name),
    ).toContain(NS);
  });

  test("the memories page composes into ONE db.batch", async () => {
    const [mems, nss] = await conn.batch([
      memoryListQuery(conn, ownerId, { namespace: NS, limit: 50 }),
      namespacesQuery(conn, ownerId),
    ]);
    expect(mems.length).toBeGreaterThan(0);
    expect((nss as unknown as { rows: unknown[] }).rows.length).toBeGreaterThan(
      0,
    );
  });

  // The digest view is the one list that still needs `metadata` (the title,
  // conversation_id and status live there) — but not the tsvector.
  test("memoryDigestQuery keeps metadata and drops content_tsv", async () => {
    const rows = await memoryDigestQuery(conn, ownerId, {
      namespace: NS,
      limit: 50,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("contentTsv");
      expect(Object.keys(row)).toContain("metadata");
      expect(Object.keys(row)).toContain("source");
    }
  });

  test("the conversations page composes into ONE db.batch", async () => {
    const [digests, nss] = await conn.batch([
      memoryDigestQuery(conn, ownerId, { tags: ["conversation"], limit: 50 }),
      namespacesQuery(conn, ownerId),
    ]);
    expect(Array.isArray(digests)).toBe(true);
    expect((nss as unknown as { rows: unknown[] }).rows.length).toBeGreaterThan(
      0,
    );
  });

  // Both detail reads used to be two SEQUENTIAL round trips; they are now one
  // batch, and the detail page appends the namespace options to the same one.
  test("the memory detail shape composes into ONE db.batch", async () => {
    const [rows, links, nss] = await conn.batch([
      memoryDetailQuery(conn, ownerId, id("M1")),
      memoryLinksQuery(conn, id("M1")),
      namespacesQuery(conn, ownerId),
    ]);
    expect(String(rows[0]?.id)).toBe(id("M1"));
    expect(Array.isArray(links)).toBe(true);
    expect((nss as unknown as { rows: unknown[] }).rows.length).toBeGreaterThan(
      0,
    );
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
