/**
 * Search engine tests — recall, ranking, filters, isolation.
 *
 * WHY INTEGRATION: ranking and filtering happen in SQL (coverage scoring,
 * trigram ILIKE, tag containment, tenant scoping). Mocking the DB would test
 * a reimplementation of the query, not the query.
 *
 * SAFETY: `DATABASE_URL` points at the live database, so every fixture is
 * written under a throwaway owner (`search-suite+<run>@sepia.test`) and deleted
 * in `afterAll` — `users → namespaces → memories/entities` all cascade. No real
 * data is read or written. Without `DATABASE_URL` the whole suite skips.
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
import { and, eq, inArray, like, lt, sql } from "drizzle-orm";
import * as v from "valibot";
import type { Db } from "../client.ts";
import { db } from "../client.ts";
import { entities, memories, namespaces, users } from "../schema.ts";
import { SearchInput } from "../../schemas.ts";
import { search, summarizeSearch, type SearchHit } from "./search.ts";
import { escapeLike, matchPlan, queryTerms } from "./util.ts";

const hasDb = Boolean(process.env.DATABASE_URL);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = `search-suite+${RUN}@sepia.test`;
const OTHER_EMAIL = `search-suite-other+${RUN}@sepia.test`;
const NS = "search-suite";
const NS2 = "search-suite-two";
const OTHER_NS = "search-suite-other";

/** Newest first: fillers are deliberately the most recent rows in the corpus. */
const T_OLD = "2026-01-01T00:00:00.000Z";
const T_FILLER = "2026-06-01T00:00:00.000Z";

/** Seeding is many Neon HTTP round trips; the 5s default hook timeout is not enough. */
const SETUP_TIMEOUT_MS = 60_000;
/** Each query is a network round trip to a pooled serverless Postgres. */
const TEST_TIMEOUT_MS = 30_000;

/**
 * Suite-local `test` — same API, but with a timeout that survives a remote DB.
 * `beforeAll`/`afterAll` keep Bun's defaults plus their own explicit timeouts.
 */
const test = (name: string, fn: () => void | Promise<unknown>) =>
  bunTest(name, fn, TEST_TIMEOUT_MS);

/** Fixture ids. `get` throws instead of returning undefined, so a mistyped key
 *  fails the test loudly rather than asserting against `undefined`. */
class Fixtures extends Map<string, string> {
  override get(key: string): string {
    const id = super.get(key);
    if (id === undefined) throw new Error(`fixture '${key}' was never seeded`);
    return id;
  }
}

describe.skipIf(!hasDb)("search", () => {
  let conn: Db;
  let ownerId = "";
  let otherOwnerId = "";
  let nsId = "";
  let otherNsId = "";
  const ids = new Fixtures();

  async function addMemory(o: {
    key: string;
    content: string;
    type?: string;
    importance?: number;
    tags?: string[];
    archived?: boolean | null;
    metadata?: Record<string, unknown>;
    updatedAt?: string;
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
        updatedAt: o.updatedAt,
      })
      .returning({ id: memories.id });
    const id = String(row!.id);
    ids.set(o.key, id);
    return id;
  }

  async function addEntity(o: {
    key: string;
    name: string;
    type: string;
    summary?: string;
    importance?: number;
    updatedAt?: string;
    namespaceId?: string;
  }): Promise<string> {
    const [row] = await conn
      .insert(entities)
      .values({
        namespaceId: o.namespaceId ?? nsId,
        name: o.name,
        type: o.type,
        summary: o.summary ?? "",
        importance: o.importance ?? 0.5,
        updatedAt: o.updatedAt,
      })
      .returning({ id: entities.id });
    const id = String(row!.id);
    ids.set(o.key, id);
    return id;
  }

  /** Search this suite's owner, scoped to the suite namespace by default. */
  function run(q: string, extra: Record<string, unknown> = {}) {
    return search(conn, ownerId, { q, namespace: NS, ...extra });
  }

  /** Total memories in the database — proves a query cannot mutate data. */
  async function countMemories(): Promise<number> {
    const res = await conn.execute(
      sql`SELECT count(*)::int AS n FROM memories`,
    );
    const row = res.rows[0] as { n: number } | undefined;
    if (!row) throw new Error("count(*) returned no rows");
    return Number(row.n);
  }

  const keysOf = (hits: Awaited<ReturnType<typeof run>>) =>
    hits.map((h) => h.id);

  beforeAll(async () => {
    conn = db();

    // Self-heal: clear rows left by an interrupted earlier run.
    await conn
      .delete(users)
      .where(like(users.email, "search-suite%@sepia.test"));

    const [owner] = await conn
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Search Suite",
        email: OWNER_EMAIL,
      })
      .returning({ id: users.id });
    ownerId = String(owner!.id);

    const [other] = await conn
      .insert(users)
      .values({ id: crypto.randomUUID(), name: "Other", email: OTHER_EMAIL })
      .returning({ id: users.id });
    otherOwnerId = String(other!.id);

    const [ns] = await conn
      .insert(namespaces)
      .values({ ownerId, name: NS, description: "test" })
      .returning({ id: namespaces.id });
    nsId = String(ns!.id);

    const [otherNs] = await conn
      .insert(namespaces)
      .values({ ownerId: otherOwnerId, name: OTHER_NS, description: "test" })
      .returning({ id: namespaces.id });
    otherNsId = String(otherNs!.id);

    // ── Corpus ────────────────────────────────────────────────────────────
    // A: covers half of "jev bun runtime preference"; old + high importance,
    //    so it also guards pre-ranking truncation on single-word queries.
    await addMemory({
      key: "A",
      content: "Jev prefers Bun over Node for new scripts",
      type: "preference",
      importance: 0.9,
      tags: ["tooling"],
      updatedAt: T_OLD,
    });
    // B: deploy vocab only — "bun" is absent.
    await addMemory({
      key: "B",
      content: "Deploy Sepia to Fly with fly deploy",
      importance: 0.7,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    // C: the only row covering both "bun" and "deploy".
    await addMemory({
      key: "C",
      content: "Bun deploy pipeline notes for the Sepia project",
      importance: 0.6,
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    // D1..D30: newer, low value, substring-only matches for "bun" (as in
    // "bunny"). One multi-row insert — Neon HTTP charges a round trip each.
    const fillers = await conn
      .insert(memories)
      .values(
        Array.from({ length: 30 }, (_, i) => ({
          namespaceId: nsId,
          content: `bunny sighting number ${i} in the garden`,
          importance: 0.2,
          updatedAt: T_FILLER,
        })),
      )
      .returning({ id: memories.id });
    fillers.forEach((row, i) => ids.set(`D${i}`, String(row.id)));
    // E: the other half of "bun neon".
    await addMemory({
      key: "E",
      content: "Neon Postgres connection pooling caveats",
      importance: 0.5,
      updatedAt: "2026-01-04T00:00:00.000Z",
    });
    // J: literal '%' — exercises the escaped phrase pattern end to end.
    await addMemory({
      key: "J",
      content: "Deploy is 42% complete for Sepia",
      importance: 0.6,
      updatedAt: "2026-01-09T00:00:00.000Z",
    });
    // F: long body — the match sits far past the first 200 chars.
    await addMemory({
      key: "F",
      content: `${"lorem ipsum dolor sit amet ".repeat(13)}zebra crossing marker at the end`,
      importance: 0.5,
      updatedAt: "2026-01-06T00:00:00.000Z",
    });
    // G: conversation digest — title/handoff searchable, transcript is not.
    await addMemory({
      key: "G",
      content: "Session digest about handoff",
      type: "fact",
      importance: 0.85,
      tags: ["conversation"],
      metadata: {
        kind: "conversation",
        conversation_id: `conv-${RUN}`,
        title: "Auth migration to Neon",
        transcript: "zqxjvmarker appears only inside the raw transcript",
      },
      updatedAt: "2026-01-07T00:00:00.000Z",
    });
    // H: archived → never returned.
    await addMemory({
      key: "H",
      content: "archived note about bun",
      archived: true,
      updatedAt: "2026-01-08T00:00:00.000Z",
    });
    // I: archived IS NULL (legacy rows) → must be treated as active.
    const iId = await addMemory({
      key: "I",
      content: "legacy note about bun",
      importance: 0.4,
      updatedAt: "2026-01-05T00:00:00.000Z",
    });
    await conn.execute(
      sql`UPDATE ${memories} SET archived = NULL WHERE id = ${iId}`,
    );

    // U: non-ASCII content — accented words must stay one token, not fragments.
    await addMemory({
      key: "U",
      content: "Köln office address for the café stand",
      importance: 0.5,
      updatedAt: "2026-01-10T00:00:00.000Z",
    });
    // V: decoy for the escaped-phrase test. It contains both query terms and
    // would ALSO satisfy the *unescaped* phrase pattern '%42% complete%'
    // ("42" … " complete") — and outranks J on importance, so it wins unless the
    // '%' is escaped. Without a decoy the escaping assertions cannot fail.
    await addMemory({
      key: "V",
      content: "42 things then complete rollout for Sepia",
      importance: 0.95,
      updatedAt: "2026-01-12T00:00:00.000Z",
    });
    // W: decoy for the phrase-bonus test. Same four words as E in a different
    // order (no verbatim phrase), higher importance — so E must win on the
    // phrase bonus alone, not on the WHERE clause.
    await addMemory({
      key: "W",
      content: "postgres pooling and neon connection notes",
      importance: 0.9,
      updatedAt: "2026-01-13T00:00:00.000Z",
    });
    // X/Y: the coverage-dominance pair. X covers all TWELVE query terms as
    // substrings; Y covers eleven as whole words with a far higher importance.
    // With a fixed coverage weight Y would win (11x100 + 11x10 = 1210 > 12x100),
    // which would also make `partial` wrong. Coverage must dominate for any term
    // count, so the weight scales with the query.
    await addMemory({
      key: "X",
      content:
        "alphax bravox charliex deltax echox foxtrotx golfx hotelx indiax julietx kilox limax",
      importance: 0.2,
      updatedAt: "2026-01-14T00:00:00.000Z",
    });
    await addMemory({
      key: "Y",
      content:
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo",
      importance: 0.99,
      updatedAt: "2026-01-15T00:00:00.000Z",
    });

    // Entities — Q is only findable through its summary.
    await addEntity({
      key: "P",
      name: "Jev",
      type: "person",
      summary: "the user behind Sepia",
    });
    await addEntity({
      key: "Q",
      name: "Qwik",
      type: "tool",
      summary: "signal-based reactive framework with resumability",
    });
    await addEntity({
      key: "S",
      name: "Sepia",
      type: "project",
      summary: "personal memory server",
    });

    // Another tenant, own namespace, colliding vocabulary.
    await conn.insert(memories).values({
      namespaceId: otherNsId,
      content: "bun secretz exclusive tenant data",
      importance: 0.9,
    });

    // A second namespace owned by the SAME owner — namespace filtering must
    // isolate within an owner, not just across owners.
    const [ns2] = await conn
      .insert(namespaces)
      .values({ ownerId, name: NS2, description: "test 2" })
      .returning({ id: namespaces.id });
    await addMemory({
      key: "N",
      content: "bun notes filed in the second namespace",
      importance: 0.5,
      namespaceId: String(ns2!.id),
      updatedAt: "2026-01-11T00:00:00.000Z",
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!conn) return;
    await conn
      .delete(users)
      .where(like(users.email, "search-suite%@sepia.test"));
  }, SETUP_TIMEOUT_MS);

  // ── Recall: partial matches must not vanish ───────────────────────────
  // The reported failure: a natural multi-word query returned 0 hits while
  // matches existed, so the agent concluded "no memories exist".
  test("returns hits when only some query terms match", async () => {
    const hits = await run("Jev bun runtime preference");
    expect(keysOf(hits)).toContain(ids.get("A"));
  });

  test("matches terms spread across different rows", async () => {
    const hits = await run("bun neon");
    expect(keysOf(hits)).toContain(ids.get("A")); // "Bun"
    expect(keysOf(hits)).toContain(ids.get("E")); // "Neon"
  });

  test("rows covering more query terms rank higher", async () => {
    const hits = await run("bun deploy");
    expect(keysOf(hits)[0]).toBe(ids.get("C")!);
  });

  test("single-word queries still match substrings", async () => {
    const hits = await run("Jev");
    expect(keysOf(hits)).toContain(ids.get("A"));
    expect(keysOf(hits)).toContain(ids.get("P"));
  });

  test("a query matching nothing returns nothing", async () => {
    expect(await run("zzqqxxvv")).toEqual([]);
  });

  test("a literal '%' is escaped, not treated as a wildcard", async () => {
    // J contains the literal "42% complete"; V contains the same words scattered
    // and would match the UNESCAPED phrase pattern '%42% complete%'. V also has
    // higher importance, so only escaping keeps J on top.
    const hits = await run("42% complete");
    expect(keysOf(hits)).toContain(ids.get("J"));
    expect(keysOf(hits)).toContain(ids.get("V"));
    expect(keysOf(hits)[0]).toBe(ids.get("J")!);
  });

  test("a wildcard-only query does not match the whole corpus", async () => {
    // Unescaped, '%' becomes '%%%' and matches every row (proven against the
    // live DB: 2320/2320). Escaped, it matches only a literal '%'.
    const pct = await run("%", { limit: 25 });
    expect(keysOf(pct)).toContain(ids.get("J"));
    expect(keysOf(pct)).not.toContain(ids.get("A"));
    expect(keysOf(pct)).not.toContain(ids.get("E"));

    // '_' is the other LIKE wildcard; nothing in this namespace contains one.
    expect(await run("_")).toEqual([]);
  });

  test("metacharacter-laden queries are safe to run", async () => {
    const before = await countMemories();
    // Regex metacharacters, LIKE wildcards, and a SQL-injection payload all
    // reach the query builder — none may throw or alter the database.
    expect(run("a*b(c[")).resolves.toBeDefined();
    expect(run("%_\\")).resolves.toBeDefined();
    expect(run("100%'); DROP TABLE memories; --")).resolves.toBeDefined();
    expect(await countMemories()).toBe(before);
  });

  // ── Ranking integrity ────────────────────────────────────────────────
  test("the best match survives a crowd of newer weak matches", async () => {
    const hits = await run("bun", { limit: 5 });
    expect(keysOf(hits)).toContain(ids.get("A"));
  });

  test("a verbatim phrase outranks the same words scattered", async () => {
    // E holds the phrase; W holds all four words in another order with HIGHER
    // importance, so only the phrase bonus can put E first — and W must be a
    // candidate, otherwise the WHERE clause would be doing the work.
    const hits = await run("neon postgres connection pooling");
    expect(keysOf(hits)).toContain(ids.get("W"));
    expect(keysOf(hits)[0]).toBe(ids.get("E")!);
  });

  test("coverage outranks word/phrase bonuses at any term count", async () => {
    // X covers 12/12 as substrings; Y covers 11/12 as whole words with 0.99
    // importance. A fixed coverage weight would rank Y first (1210 > 1200) and
    // would also make `partial` lie. Coverage must always dominate.
    const hits = await run(
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima",
      { limit: 25 },
    );
    expect(keysOf(hits)).toContain(ids.get("Y"));
    expect(keysOf(hits)[0]).toBe(ids.get("X")!);
    expect(hits.find((h) => h.id === ids.get("X"))!.matched_terms).toBe(12);
    expect(hits.find((h) => h.id === ids.get("Y"))!.matched_terms).toBe(11);
  });

  test("importance breaks ties at equal coverage", async () => {
    // A, C and I all match "bun" as a whole word (score 115), so their order is
    // decided purely by importance: 0.9 > 0.6 > 0.4. The archived row is out.
    const hits = await run("bun", { limit: 25 });
    const order = keysOf(hits);
    const a = order.indexOf(ids.get("A")!);
    const c = order.indexOf(ids.get("C")!);
    const i = order.indexOf(ids.get("I")!);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(c).toBeGreaterThan(a);
    expect(i).toBeGreaterThan(c);
    expect(order).not.toContain(ids.get("H"));
  });

  // ── Entities ─────────────────────────────────────────────────────────
  test("entities are findable through their summary", async () => {
    const hits = await run("reactive framework");
    const hit = hits.find((h) => h.id === ids.get("Q"));
    expect(hit).toBeDefined();
    expect(hit!.kind).toBe("entity");
  });

  test("an entity's snippet shows why it matched", async () => {
    const hits = await run("reactive framework");
    const hit = hits.find((h) => h.id === ids.get("Q"));
    expect(hit!.snippet.toLowerCase()).toContain("reactive");
  });

  // ── Metadata ─────────────────────────────────────────────────────────
  test("digest titles in metadata are searchable", async () => {
    const hits = await run("migration");
    expect(keysOf(hits)).toContain(ids.get("G"));
  });

  test("digest transcripts are NOT searchable", async () => {
    expect(await run("zqxjvmarker")).toEqual([]);
  });

  test("metadata KEY names are not searched, only digest values", async () => {
    // "conversation_id" / "kind" are JSON keys. Matching them meant every digest
    // hit for schema words — noise that hid real matches. Only the `title`,
    // `conversation_id` VALUE and `source_ai` are part of the haystack.
    const hits = await run("conversation");
    expect(keysOf(hits)).not.toContain(ids.get("G"));
  });

  // ── Filters ──────────────────────────────────────────────────────────
  test("empty q returns recent items", async () => {
    const hits = await run("", { limit: 10 });
    expect(hits.length).toBeGreaterThan(0);
  });

  test("empty q still applies the type filter", async () => {
    const hits = await run("", { type: "preference", limit: 25 });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.kind).toBe("memory");
      expect(hit.type).toBe("preference");
    }
  });

  test("empty q still applies the tags filter", async () => {
    const hits = await run("", { tags: ["tooling"], limit: 25 });
    expect(keysOf(hits)).toContain(ids.get("A"));
    for (const hit of hits) expect(hit.id).toBe(ids.get("A")!);
  });

  test("namespace filter isolates rows to that namespace", async () => {
    const hits = await run("bun", { namespace: NS2, limit: 25 });
    expect(keysOf(hits)).toContain(ids.get("N"));
    expect(keysOf(hits)).not.toContain(ids.get("A"));
    expect(keysOf(hits)).not.toContain(ids.get("C"));
  });

  test("another owner's namespace is rejected, not silently searched", async () => {
    // Namespaces are per-owner: a name that exists for someone else is simply
    // "not found" here — loud, so it cannot be probed or mistaken for empty.
    expect(run("bun", { namespace: OTHER_NS })).rejects.toThrow();
  });

  // ── Tenant isolation ─────────────────────────────────────────────────
  test("another owner's memories are never returned", async () => {
    const hits = await search(conn, ownerId, { q: "secretz" });
    expect(hits).toEqual([]);
  });

  // ── Snippets ─────────────────────────────────────────────────────────
  test("snippet is centred on the match, not the first 200 chars", async () => {
    const hits = await run("zebra");
    const hit = hits.find((h) => h.id === ids.get("F"));
    expect(hit).toBeDefined();
    expect(hit!.snippet.toLowerCase()).toContain("zebra");
  });

  test("archived rows are excluded but NULL-archived rows are kept", async () => {
    const hits = await run("bun", { limit: 25 });
    expect(keysOf(hits)).not.toContain(ids.get("H"));
    expect(keysOf(hits)).toContain(ids.get("I"));
  });

  test("respects the limit", async () => {
    const hits = await run("bun", { limit: 3 });
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  // ── Coverage signal (what the MCP result surfaces as `partial`) ────────
  test("matched_terms reports how much of the query a row covered", async () => {
    const full = await run("bun deploy");
    expect(full[0]!.matched_terms).toBe(2);

    const partial = await run("Jev bun runtime preference");
    const a = partial.find((h) => h.id === ids.get("A"))!;
    expect(a.matched_terms).toBe(2); // "jev" + "bun"; "runtime"/"preference" absent
  });

  test("summarizeSearch grade matches the hit it is built from", async () => {
    const q = "Jev bun runtime preference";
    const hits = await run(q);
    expect(summarizeSearch(q, hits).partial).toBe(true);

    const exact = "neon postgres connection pooling";
    const exactHits = await run(exact);
    expect(summarizeSearch(exact, exactHits).partial).toBe(false);
  });

  test("repeating a term does not inflate coverage", async () => {
    const hits = await run("bun bun bun");
    expect(hits[0]!.matched_terms).toBe(1);
  });

  // ── Filters in combination ───────────────────────────────────────────
  test("type filter applies alongside a query", async () => {
    const hits = await run("bun", { type: "preference", limit: 25 });
    expect(keysOf(hits)).toContain(ids.get("A"));
    for (const hit of hits) {
      expect(hit.kind).toBe("memory");
      expect(hit.type).toBe("preference");
    }
  });

  test("entity type filter excludes other entity types", async () => {
    const tools = await run("reactive", { type: "tool", limit: 25 });
    expect(keysOf(tools)).toContain(ids.get("Q"));
    for (const hit of tools) expect(hit.kind).toBe("entity");

    const people = await run("reactive", { type: "person", limit: 25 });
    expect(keysOf(people)).not.toContain(ids.get("Q"));
  });

  test("tags and query combine (filter + rank)", async () => {
    const hits = await run("digest", { tags: ["conversation"], limit: 25 });
    expect(keysOf(hits)).toContain(ids.get("G"));
    for (const hit of hits) expect(hit.id).toBe(ids.get("G"));
  });

  test("conversation resume path: q='' + tags=['conversation']", async () => {
    const hits = await run("", { tags: ["conversation"], limit: 25 });
    expect(keysOf(hits)).toContain(ids.get("G"));
  });

  test("namespace + tags + type filters combine", async () => {
    const hits = await run("", {
      namespace: NS,
      tags: ["tooling"],
      type: "preference",
      limit: 25,
    });
    expect(hits.map((h) => h.id)).toEqual([ids.get("A")]);
  });

  // ── min_terms: the precision dial ────────────────────────────────────
  // Nonsense tokens keep these assertions hermetic — no other fixture in the
  // suite can match them, so the expected sets are exact.
  test("min_terms drops lower-coverage hits and keeps the best", async () => {
    await addMemory({ key: "MT_FULL", content: "zebraqux plumbusfoo alpha" });
    await addMemory({ key: "MT_ONE", content: "zebraqux elsewhere" });

    const loose = await run("zebraqux plumbusfoo");
    expect(keysOf(loose)).toContain(ids.get("MT_FULL"));
    expect(keysOf(loose)).toContain(ids.get("MT_ONE"));

    const strict = await run("zebraqux plumbusfoo", { min_terms: 2 });
    expect(strict.map((h) => h.id)).toEqual([ids.get("MT_FULL")]);
    expect(strict[0]!.matched_terms).toBe(2);
  });

  test("min_terms is applied before the LIMIT, so a page still fills", async () => {
    const hits = await run("zebraqux plumbusfoo", { min_terms: 2, limit: 1 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.id).toBe(ids.get("MT_FULL"));
  });

  test("min_terms above the achievable coverage returns nothing, not noise", async () => {
    const hits = await run("zebraqux plumbusfoo", { min_terms: 5 });
    expect(hits).toEqual([]);
  });

  test("summarizeSearch reports the best coverage achieved", () => {
    const hit = (matched_terms: number) =>
      ({ matched_terms }) as Parameters<typeof summarizeSearch>[1][number];
    const full = summarizeSearch("alpha beta gamma", [hit(3), hit(1)]);
    expect(full.best_matched_terms).toBe(3);
    expect(full.partial).toBe(false);
    const partial = summarizeSearch("alpha beta gamma", [hit(2), hit(1)]);
    expect(partial.best_matched_terms).toBe(2);
    expect(partial.partial).toBe(true);
  });

  // ── Text handling ────────────────────────────────────────────────────
  test("query matching is case- and whitespace-insensitive", async () => {
    const hits = await run("   JeV   bUn   ");
    expect(keysOf(hits)).toContain(ids.get("A"));
  });

  test("accented words stay searchable as whole words", async () => {
    const hits = await run("Köln");
    expect(keysOf(hits)).toContain(ids.get("U"));
  });

  test("an archived row is never returned, even as a strong match", async () => {
    const hits = await run("archived note");
    expect(keysOf(hits)).not.toContain(ids.get("H"));
  });

  test("snippets stay bounded even for very long content", async () => {
    const hits = await run("zebra");
    const hit = hits.find((h) => h.id === ids.get("F"))!;
    expect(hit.snippet.length).toBeLessThanOrEqual(210);
  });

  test("a metadata-only match still shows why it matched", async () => {
    const hits = await run("migration");
    const hit = hits.find((h) => h.id === ids.get("G"))!;
    expect(hit.snippet.toLowerCase()).toContain("migration");
  });

  test("limit above the maximum is clamped", async () => {
    const hits = await run("bun", { limit: 9999 });
    expect(hits.length).toBeLessThanOrEqual(25);
  });

  test("an unknown namespace fails loudly instead of looking empty", async () => {
    // "bun" matches plenty of rows; a namespace typo must not read as "nothing found".
    expect(run("bun", { namespace: "nope-not-a-namespace" })).rejects.toThrow();
  });

  test("limit truncates but the coverage signal stays truthful", async () => {
    const hits = await run("bun neon", { limit: 1 });
    expect(hits.length).toBe(1);
    const terms = summarizeSearch("bun neon", hits).terms;
    expect(hits[0]!.matched_terms).toBeLessThanOrEqual(terms.length);
    expect(summarizeSearch("bun neon", hits).partial).toBe(true);
  });

  test("memories and entities are merged into one ranked result set", async () => {
    const hits = await run("Sepia", { limit: 25 });
    expect(hits.some((h) => h.kind === "memory")).toBe(true);
    expect(hits.some((h) => h.kind === "entity")).toBe(true);
  });

  test("whitespace-only q takes the recent-items path", async () => {
    const hits = await run("   ", { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.matched_terms).toBe(0);
  });
});

// ── Pure helpers — no database required ────────────────────────────────

describe("queryTerms", () => {
  test("lowercases, dedupes, and drops single-character noise", () => {
    expect(queryTerms("Bun bun a BUN")).toEqual(["bun"]);
  });

  test("keeps a lone single-character term", () => {
    expect(queryTerms("a")).toEqual(["a"]);
  });

  test("throws away punctuation but keeps words and numbers", () => {
    expect(queryTerms("Köln, café! 42% done?")).toEqual([
      "köln",
      "café",
      "42",
      "done",
    ]);
  });

  test("returns nothing for a query with no words", () => {
    expect(queryTerms("!!! ---")).toEqual([]);
  });
});

describe("escapeLike", () => {
  test("escapes every LIKE metacharacter", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c\\d")).toBe("c\\\\d");
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
  });

  test("leaves ordinary text alone", () => {
    expect(escapeLike("deploy pipeline")).toBe("deploy pipeline");
  });
});

describe("matchPlan", () => {
  test("tokenizes a normal query", () => {
    expect(matchPlan("Bun deploy")).toEqual({
      terms: ["bun", "deploy"],
      patterns: ["%bun%", "%deploy%"],
    });
  });

  test("falls back to the literal so terms are never empty", () => {
    expect(matchPlan("!!!")).toEqual({ terms: ["!!!"], patterns: ["%!!!%"] });
  });

  test("escapes wildcards inside the literal fallback", () => {
    // Without escaping this pattern would match every row.
    expect(matchPlan("%")).toEqual({ terms: ["%"], patterns: ["%\\%%"] });
    expect(matchPlan("_")).toEqual({ terms: ["_"], patterns: ["%\\_%"] });
  });
});

describe("SearchInput", () => {
  test("caps the query at 200 characters", () => {
    expect(v.safeParse(SearchInput, { q: "x".repeat(200) }).success).toBe(true);
    expect(v.safeParse(SearchInput, { q: "x".repeat(201) }).success).toBe(
      false,
    );
  });

  test("rejects a limit above the search maximum", () => {
    expect(v.safeParse(SearchInput, { q: "x", limit: 25 }).success).toBe(true);
    expect(v.safeParse(SearchInput, { q: "x", limit: 26 }).success).toBe(false);
  });
});

describe("summarizeSearch", () => {
  const hit = (matched_terms: number): SearchHit => ({
    kind: "memory",
    id: "00000000-0000-0000-0000-000000000000",
    content: "content",
    type: "fact",
    importance: 0.5,
    updated_at: "2026-01-01T00:00:00.000Z",
    namespace: "personal",
    snippet: "content",
    score: 0,
    matched_terms,
  });

  test("flags a best-effort result set when coverage is incomplete", () => {
    expect(summarizeSearch("bun deploy neon", [hit(2)]).partial).toBe(true);
  });

  test("does not flag a fully covered query", () => {
    expect(summarizeSearch("bun deploy", [hit(2)]).partial).toBe(false);
  });

  test("an empty result set is not partial", () => {
    expect(summarizeSearch("bun", []).partial).toBe(false);
  });

  test("reports the normalized terms that were ranked on", () => {
    expect(summarizeSearch("Bun   Deploy", []).terms).toEqual([
      "bun",
      "deploy",
    ]);
  });
});
