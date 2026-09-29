/**
 * OpenSearch engine tests.
 *
 * UNIT (no cluster): DSL building, hit mapping semantics, engine resolution.
 * INTEGRATION (skipIf no DATABASE_URL / OPENSEARCH_URL): the opensearch path
 * against a live cluster — sync round-trip, filters, and fallthrough drills,
 * with fixtures seeded independently (mirroring search.test.ts's pattern) and
 * a warn-spy discriminator proving results came from the cluster, not the
 * coverage fallback. The suite forces OPENSEARCH_INDEX=sepia_test so fixtures
 * never touch a prod-mirrored index.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  afterEach,
  test as bunTest,
} from "bun:test";
import { like } from "drizzle-orm";
import type { Db } from "../client.ts";
import { db } from "../client.ts";
import { entities, memories, namespaces, users } from "../schema.ts";
import { buildOsQuery, mapHits } from "./search-opensearch.ts";
import { resolveSearchEngine, search, summarizeSearch } from "./search.ts";
import { createMemory, deleteMemory, updateMemory } from "./memories.ts";
import { __setEnvForTest, ensureIndex } from "./opensearch-client.ts";

// ── Unit: pure functions, always run ────────────────────────────────────────

describe("buildOsQuery (DSL)", () => {
  test("owner always filtered; archived excluded; best-effort recall", () => {
    const q = buildOsQuery("owner-1", { q: "bun deploy" }) as {
      query: { bool: Record<string, unknown> };
      size: number;
      sort: unknown[];
    };
    expect(JSON.stringify(q.query.bool.filter)).toContain("owner-1");
    expect(JSON.stringify(q.query.bool.must_not)).toContain("archived");
    expect(q.query.bool.minimum_should_match).toBe(1);
    expect(q.size).toBe(40); // default limit 10 × 4
    expect(q.sort[0]).toBe("_score");
  });

  test("namespace/type/tags map to term filters; size = limit × 4 capped at 100", () => {
    const q = buildOsQuery(
      "owner-1",
      {
        q: "x",
        type: "fact",
        tags: ["a", "b"],
        limit: 50,
      },
      "ns-1",
    ) as { query: { bool: { filter: unknown[] } }; size: number };
    const filters = JSON.stringify(q.query.bool.filter);
    expect(filters).toContain("ns-1");
    expect(filters).toContain("fact");
    expect(filters).toContain(`"tags"`);
    expect(q.size).toBe(100);
  });

  test("one should-clause per term plus a phrase match", () => {
    const q = buildOsQuery("owner-1", { q: "bun deploy now" }) as {
      query: { bool: { should: Array<Record<string, unknown>> } };
    };
    // 3 terms + 1 match_phrase
    expect(q.query.bool.should.length).toBe(4);
    expect(q.query.bool.should[3]).toHaveProperty("match_phrase");
  });
});

describe("mapHits (coverage-compatible semantics)", () => {
  const raw = (id: string, haystack: string, score: number) => ({
    _score: score,
    _source: {
      kind: "memory",
      id,
      haystack,
      content: haystack,
      type: "fact",
      importance: 0.5,
      namespace: "personal",
      updated_at: "2026-09-29T00:00:00.000Z",
    },
  });

  test("matched_terms uses substring semantics (case-insensitive)", () => {
    const hits = mapHits(
      [raw("m1", "BUN deploy guide", 3.2), raw("m2", "bun only", 1.1)],
      ["bun", "deploy"],
      10,
      null,
    );
    expect(hits[0]!.matched_terms).toBe(2);
    expect(hits[1]!.matched_terms).toBe(1);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  test("min_terms filters before the limit (page can still fill)", () => {
    const hits = mapHits(
      [raw("m1", "bun only", 1.1), raw("m2", "bun deploy both", 3.0)],
      ["bun", "deploy"],
      10,
      2,
    );
    expect(hits.map((h) => h.id)).toEqual(["m2"]);
  });

  test("dedupe by kind:id; slices to limit", () => {
    const hits = mapHits(
      [raw("m1", "a", 3), raw("m1", "a", 3), raw("m2", "b", 2)],
      ["a", "b"],
      1,
      null,
    );
    expect(hits.length).toBe(1);
  });

  test("memory snippets content when the match lives there", () => {
    const hits = mapHits(
      [raw("m1", "prefix bun deploy suffix and more", 3)],
      ["bun"],
      10,
      null,
    );
    expect(hits[0]!.snippet).toBe("prefix bun deploy suffix and more");
  });
});

describe("resolveSearchEngine (engine #3 resolution)", () => {
  const orig = process.env.SEARCH_ENGINE;
  afterEach(() => {
    if (orig === undefined) delete process.env.SEARCH_ENGINE;
    else process.env.SEARCH_ENGINE = orig;
  });

  test("explicit opensearch wins", () => {
    expect(resolveSearchEngine({ engine: "opensearch" })).toBe("opensearch");
  });
  test("env opensearch honored; garbage falls back to coverage", () => {
    process.env.SEARCH_ENGINE = "opensearch";
    expect(resolveSearchEngine()).toBe("opensearch");
    process.env.SEARCH_ENGINE = "nonsense";
    expect(resolveSearchEngine()).toBe("coverage");
    delete process.env.SEARCH_ENGINE;
    expect(resolveSearchEngine()).toBe("coverage");
  });
  test("bm25 still resolves", () => {
    expect(resolveSearchEngine({ engine: "bm25" })).toBe("bm25");
  });
});

// ── Integration: needs DATABASE_URL + OPENSEARCH_URL (both skipIf-guarded) ──

const hasDb = Boolean(process.env.DATABASE_URL);
const hasOs = Boolean(process.env.OPENSEARCH_URL);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = `os-suite+${RUN}@sepia.test`;
const NS = "os-suite";
const NS2 = "os-suite-two";
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;
const test = (name: string, fn: () => void | Promise<unknown>) =>
  bunTest(name, fn, TEST_TIMEOUT_MS);

describe.skipIf(!hasDb || !hasOs)("search via opensearch (integration)", () => {
  let conn: Db;
  let ownerId = "";
  let nsId = "";
  let ns2Id = "";
  let savedIndex: string | undefined;
  let savedRefresh: string | undefined;
  const ids = new Map<string, string>();

  async function addMemory(o: {
    key: string;
    content: string;
    type?: string;
    importance?: number;
    tags?: string[];
    archived?: boolean;
    metadata?: Record<string, unknown>;
    namespaceId?: string;
  }): Promise<string> {
    const [row] = await conn
      .insert(memories)
      .values({
        namespaceId: o.namespaceId ?? nsId,
        content: o.content,
        type: o.type ?? "fact",
        importance: o.importance ?? 0.5,
        tags: o.tags ?? [],
        archived: o.archived ?? false,
        metadata: o.metadata ?? {},
      })
      .returning({ id: memories.id });
    const id = String(row!.id);
    ids.set(o.key, id);
    return id;
  }

  beforeAll(async () => {
    savedRefresh = process.env.OPENSEARCH_TEST_REFRESH;
    process.env.OPENSEARCH_TEST_REFRESH = "1";
    // Tests ALWAYS target a dedicated index, whatever the local .env says —
    // fixtures must never touch a prod-mirrored index.
    savedIndex = process.env.OPENSEARCH_INDEX;
    process.env.OPENSEARCH_INDEX = "sepia_test";
    conn = db();
    // Self-heal rows from an interrupted earlier run.
    await conn.delete(users).where(like(users.email, "os-suite%@sepia.test"));
    const [owner] = await conn
      .insert(users)
      .values({ id: crypto.randomUUID(), name: "OS Suite", email: OWNER_EMAIL })
      .returning({ id: users.id });
    ownerId = String(owner!.id);
    const [ns] = await conn
      .insert(namespaces)
      .values({ ownerId, name: NS })
      .returning({ id: namespaces.id });
    nsId = String(ns!.id);
    const [ns2] = await conn
      .insert(namespaces)
      .values({ ownerId, name: NS2 })
      .returning({ id: namespaces.id });
    ns2Id = String(ns2!.id);

    await addMemory({
      key: "prefix",
      content: "the migration plan covers deploys",
      importance: 0.9,
    });
    await addMemory({
      key: "partial",
      content: "only bun is mentioned here",
      importance: 0.8,
    });
    await addMemory({
      key: "digest",
      content: "Conversation digest body without keyword",
      metadata: {
        kind: "conversation",
        title: "opensearch digest title",
        conversation_id: "os-digest-2026",
      },
      importance: 0.7,
    });
    await addMemory({
      key: "instr",
      content: "instructional bun recipe memory",
      type: "instruction",
      importance: 0.6,
    });
    await addMemory({
      key: "tagged",
      content: "tagged with uniqueword",
      tags: ["opstest"],
      importance: 0.6,
    });
    await addMemory({
      key: "ns2",
      content: "nsfournow lives only in the second namespace",
      namespaceId: ns2Id,
      importance: 0.6,
    });
    const [ent] = await conn
      .insert(entities)
      .values({
        namespaceId: nsId,
        name: "OpenSearch Entity",
        type: "tool",
        summary: "external ranking engine",
        importance: 0.6,
      })
      .returning({ id: entities.id });
    const entityId = String(ent!.id);

    // Another OWNER with a same-named namespace and a distinctive memory —
    // proves the owner_id filter, not just the namespace filter, is load-bearing.
    const [other] = await conn
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "OS Suite Other",
        email: `os-suite-other+${RUN}@sepia.test`,
      })
      .returning({ id: users.id });
    const [otherNs] = await conn
      .insert(namespaces)
      .values({ ownerId: String(other!.id), name: NS })
      .returning({ id: namespaces.id });
    await conn.insert(memories).values({
      namespaceId: String(otherNs!.id),
      content: "otherbun distinctive other tenant content",
      type: "fact",
      importance: 0.9,
      tags: [],
      archived: false,
      metadata: {},
    });

    await ensureIndex();
    const { syncMemoryIds, syncEntityIds } = await import("./index-sync.ts");
    await syncMemoryIds(conn, [...ids.values()]);
    await syncEntityIds(conn, [entityId]);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    // Restore shared env FIRST — if cleanup below throws, later suites in
    // this bun process must still see the original OPENSEARCH_* values.
    if (savedRefresh === undefined) delete process.env.OPENSEARCH_TEST_REFRESH;
    else process.env.OPENSEARCH_TEST_REFRESH = savedRefresh;
    if (savedIndex === undefined) delete process.env.OPENSEARCH_INDEX;
    else process.env.OPENSEARCH_INDEX = savedIndex;
    const { unsyncMemory, unsyncByNamespace } = await import("./index-sync.ts");
    for (const id of ids.values()) await unsyncMemory(conn, id);
    await unsyncByNamespace(nsId);
    await unsyncByNamespace(ns2Id);
    await conn.delete(users).where(like(users.email, "os-suite%@sepia.test"));
  }, SETUP_TIMEOUT_MS);

  const run = (q: string, extra: Record<string, unknown> = {}) =>
    search(conn, ownerId, { q, namespace: NS, engine: "opensearch", ...extra });

  /**
   * Run a search AND assert OpenSearch actually served it. `search()` falls
   * through to coverage on any cluster problem and logs a `[opensearch]`
   * warning first — so a silent run is the discriminator that proves the
   * engine (not the fallback) produced these results. Without this, every
   * outcome-based assertion below would pass even against a dead engine.
   */
  async function runServed(q: string, extra: Record<string, unknown> = {}) {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.join(" "));
      orig(...args);
    };
    try {
      const hits = await run(q, extra);
      const osWarns = warns.filter((w) => w.startsWith("[opensearch]"));
      expect(osWarns).toEqual([]);
      return hits;
    } finally {
      console.warn = orig;
    }
  }

  /** Fixture getter — a mistyped key fails loudly, not against undefined. */
  const fid = (key: string): string => {
    const v = ids.get(key);
    if (!v) throw new Error(`fixture '${key}' was never seeded`);
    return v;
  };

  test("prefix recall: partial word finds the word (edge-ngram)", async () => {
    const hits = await runServed("migra");
    expect(hits.map((h) => h.id)).toContain(fid("prefix"));
  });

  test("digest metadata (title/conversation_id) is searchable", async () => {
    const hits = await runServed("os-digest-2026");
    expect(hits.map((h) => h.id)).toContain(fid("digest"));
  });

  test("multi-term: better coverage ranks first; matched_terms reflects it", async () => {
    const hits = await runServed("bun mentioned");
    const top = hits[0]!;
    expect(top.id).toBe(fid("partial"));
    expect(top.matched_terms).toBe(2);
    const summary = summarizeSearch("bun mentioned", hits);
    expect(summary.terms.length).toBe(2);
    expect(summary.best_matched_terms).toBe(2);
  });

  test("min_terms drops partial matches", async () => {
    const loose = await run("bun migration", { min_terms: 1 });
    expect(loose.length).toBeGreaterThan(0);
    const strict = await run("bun migration", { min_terms: 2 });
    for (const h of strict) expect(h.matched_terms).toBeGreaterThanOrEqual(2);
  });

  test("entity hits come back with name + haystack snippet", async () => {
    const hits = await runServed("external ranking");
    const hit = hits.find((h) => h.kind === "entity");
    expect(hit?.name).toBe("OpenSearch Entity");
    expect(hit?.snippet).toContain("external ranking engine");
  });

  // ── Contract tests the plan requires (round-trip + SQL path + filters) ──

  // bunTest directly: the suite-local `test` wrapper has no timeout argument,
  // and this one drives six DB+cluster round trips.
  bunTest(
    "round-trip: create → searchable, update → re-indexed, delete → gone",
    async () => {
      // Drives the REAL mutation functions so their write-through hooks are
      // what is under test — not the seeding helper's direct inserts.
      const created = await createMemory(conn, ownerId, {
        content: "roundtrip zzseed phrase for sync",
        namespace: NS,
      });
      const createdId = String(created!.id);
      ids.set(`rt-${createdId}`, createdId);
      expect((await runServed("zzseed")).map((h) => h.id)).toContain(createdId);

      await updateMemory(conn, ownerId, createdId, {
        content: "roundtrip zzupdated phrase for sync",
      });
      const afterUpdate = await runServed("zzupdated");
      expect(afterUpdate.map((h) => h.id)).toContain(createdId);
      expect(afterUpdate[0]!.content).toContain("zzupdated");

      await deleteMemory(conn, ownerId, createdId);
      expect((await run("zzupdated")).map((h) => h.id)).not.toContain(
        createdId,
      );
    },
    SETUP_TIMEOUT_MS,
  );

  test("empty q takes the SQL recency path even under engine=opensearch", async () => {
    const hits = await search(conn, ownerId, {
      q: "",
      namespace: NS,
      engine: "opensearch",
    });
    expect(hits.length).toBeGreaterThan(0);
    // SQL-path evidence: the recent-items path scores everything 0 — an
    // OpenSearch-served result would carry a non-zero _score, so this FAILS
    // if an empty q were ever routed through the cluster.
    for (const h of hits) expect(h.score).toBe(0);
    // Nothing was ranked → no coverage to report (same contract as coverage).
    expect(summarizeSearch("", hits).terms).toEqual([]);
    expect(summarizeSearch("", hits).partial).toBe(false);
  });

  test("type filter isolates memory types", async () => {
    const hits = await runServed("bun", { type: "instruction" });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.type).toBe("instruction");
    expect(hits.map((h) => h.id)).toContain(fid("instr"));
    expect(hits.map((h) => h.id)).not.toContain(fid("partial"));
  });

  test("tags filter matches ALL tags (containment, like @>)", async () => {
    const hits = await runServed("uniqueword", { tags: ["opstest"] });
    expect(hits.map((h) => h.id)).toEqual([fid("tagged")]);
  });

  test("namespace filter isolates rows to the requested namespace", async () => {
    const inNs2 = await runServed("nsfournow", { namespace: NS2 });
    expect(inNs2.map((h) => h.id)).toContain(fid("ns2"));
    // Same query scoped to the default suite namespace must not see it.
    const inNs = await run("nsfournow");
    expect(inNs.map((h) => h.id)).not.toContain(fid("ns2"));
  });

  test("ownership isolation: another owner's rows never appear", async () => {
    // Distinctive content exists ONLY under the other owner (same NS name).
    const hits = await search(conn, ownerId, {
      q: "otherbun distinctive",
      engine: "opensearch",
    });
    expect(hits).toHaveLength(0);
  });

  test("score direction: better coverage has higher score", async () => {
    const hits = await runServed("bun migration");
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    }
  });

  test("typo'd namespace still throws (false-zero guard, engine-independent)", async () => {
    await expect(
      search(conn, ownerId, {
        q: "anything",
        namespace: "no-such-ns",
        engine: "opensearch",
      }),
    ).rejects.toThrow();
  });

  test("fallthrough: dead cluster resolves with coverage results", async () => {
    __setEnvForTest({ url: "http://127.0.0.1:1", timeoutMs: 300 });
    try {
      const hits = await run("bun");
      // Coverage finds the partial fixture — search NEVER throws or empties.
      expect(hits.map((h) => h.id)).toContain(fid("partial"));
    } finally {
      __setEnvForTest(null);
    }
  });

  test("unconfigured opensearch falls back to coverage (engine honored, no crash)", async () => {
    __setEnvForTest(null);
    process.env.OPENSEARCH_URL_BACKUP = process.env.OPENSEARCH_URL;
    delete process.env.OPENSEARCH_URL;
    try {
      const hits = await run("bun");
      expect(hits.length).toBeGreaterThan(0);
    } finally {
      process.env.OPENSEARCH_URL = process.env.OPENSEARCH_URL_BACKUP!;
      delete process.env.OPENSEARCH_URL_BACKUP;
    }
  });
});
