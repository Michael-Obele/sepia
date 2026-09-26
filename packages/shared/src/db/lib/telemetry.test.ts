/**
 * Telemetry tests — what the summary CLAIMS versus what the log holds.
 *
 * WHY INTEGRATION: every number the dashboard and CLI print is derived in SQL
 * (the zero-result partition, truncation, coverage, the retry rate). A mocked
 * result would test a reimplementation of the query, not the query — and this
 * is exactly the class of code that once shipped a silently-swapped aggregate
 * (see stats.ts: 11 batch results read by position, no error, wrong UI).
 *
 * The load-bearing assertions:
 *   1. an empty result is CLASSIFIED — bare vs precision (min_terms) vs
 *      filtered — because those three mean different things and used to be one
 *      indistinguishable `zero_result`;
 *   2. `truncated` knows the requested page size, so "we ran out of page"
 *      never reads as "we found nothing";
 *   3. the recent-items path (empty q, terms = 0) is excluded from coverage
 *      and zero rates instead of dragging them down;
 *   4. `retried_after_zero` counts only a follow-up after an actual zero —
 *      the honest failure signal, next to `reformulated` which counts every
 *      chained search and is NOT a failure rate;
 *   5. the engine split reports which engines were EXPLICITLY requested, so
 *      self-selected traffic can be told apart from default traffic;
 *   6. query text never reaches `options`, and a tier below `transcripts`
 *      never writes it at all (the privacy guarantee, in code).
 *
 * SAFETY: same throwaway-owner pattern as search.test.ts — fixtures live under
 * `telemetry-suite+<run>@sepia.test` and are deleted in `afterAll` (users
 * cascade to their settings and events). Self-heal only touches rows older
 * than an hour and scoped to this suite's email pattern. Without
 * DATABASE_URL the whole file skips.
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
import { desc, eq, inArray, like } from "drizzle-orm";
import * as v from "valibot";
import type { Db } from "../client.ts";
import { db } from "../client.ts";
import { telemetryEvents, users } from "../schema.ts";
import { SearchInput } from "../../schemas.ts";
import {
  PURGE_INTERVAL_MS,
  maybePurgeExpiredTelemetry,
  recordTelemetry,
  searchOptions,
  setTelemetrySettings,
  setTelemetryTtl,
  telemetryFailures,
  telemetrySummary,
} from "./telemetry.ts";

const hasDb = Boolean(process.env.DATABASE_URL);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = `telemetry-suite+${RUN}@sepia.test`;
const RECORD_EMAIL = `telemetry-suite-record+${RUN}@sepia.test`;
const PURGE_EMAIL = `telemetry-suite-purge+${RUN}@sepia.test`;
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

const test = (name: string, fn: () => void | Promise<unknown>) =>
  bunTest(name, fn, TEST_TIMEOUT_MS);

/** Minutes before "now", for explicit `created_at` values. */
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const DEFAULT_LIMIT = 10;

describe.skipIf(!hasDb)("telemetrySummary", () => {
  let conn: Db;
  let ownerId = "";
  /** Seeded rows, so a failure names the row instead of a bare number. */
  const rows: Array<{ key: string; query: string }> = [];

  /**
   * One search event. `session` null keeps a row OUT of the loop aggregates
   * (repeated / reformulated / retried), which are derived per session.
   */
  async function seed(o: {
    key: string;
    query: string;
    terms: number;
    best: number;
    hits: number;
    options?: Record<string, unknown>;
    engine?: string;
    session?: string;
    minutesAgo: number;
  }): Promise<void> {
    await conn.insert(telemetryEvents).values({
      ownerId,
      sessionHash: o.session ?? null,
      tool: "search",
      engine: o.engine ?? "coverage",
      terms: o.terms,
      bestMatchedTerms: o.best,
      hitCount: o.hits,
      latencyMs: 100,
      resultChars: 500,
      queryText: o.query,
      options: (o.options ?? { limit: DEFAULT_LIMIT }) as never,
      createdAt: ago(o.minutesAgo),
    });
    rows.push({ key: o.key, query: o.query });
  }

  beforeAll(async () => {
    conn = db();
    await conn
      .delete(users)
      .where(like(users.email, "telemetry-suite%@sepia.test"));
    const [owner] = await conn
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Telemetry Suite",
        email: OWNER_EMAIL,
      })
      .returning({ id: users.id });
    ownerId = String(owner!.id);

    // ── Zero-result partition (no session → no loop aggregates) ───────────
    // A: nothing matched and nothing narrowed it → the real failure class.
    await seed({
      key: "bare",
      query: "cold starts deploy pipeline",
      terms: 4,
      best: 0,
      hits: 0,
      minutesAgo: 60,
    });
    // B: the caller demanded all four terms. The filter did its job.
    await seed({
      key: "precision",
      query: "cold starts deploy pipeline",
      terms: 4,
      best: 0,
      hits: 0,
      options: { limit: DEFAULT_LIMIT, min_terms: 4 },
      minutesAgo: 59,
    });
    // C: scoped to a namespace that had nothing. Also not a retrieval failure.
    await seed({
      key: "filtered",
      query: "tomoshibi entity",
      terms: 2,
      best: 0,
      hits: 0,
      options: { limit: DEFAULT_LIMIT, namespace: "personal" },
      minutesAgo: 58,
    });
    // D: precision AND a filter → precision wins the precedence, so the three
    //    buckets always sum to `zero_result`.
    await seed({
      key: "precision+filtered",
      query: "entity tags convention",
      terms: 3,
      best: 0,
      hits: 0,
      options: { limit: DEFAULT_LIMIT, min_terms: 3, type: "fact" },
      minutesAgo: 57,
    });

    // ── Truncation ────────────────────────────────────────────────────────
    // E: exactly the requested page size → the page was cut, not exhausted.
    await seed({
      key: "truncated",
      query: "svelte components",
      terms: 2,
      best: 2,
      hits: 10,
      options: { limit: 10 },
      minutesAgo: 56,
    });
    // F: 10 hits out of a requested 25 → NOT truncated, and it covers half.
    await seed({
      key: "not-truncated",
      query: "deploy pipeline notes",
      terms: 2,
      best: 1,
      hits: 10,
      options: { limit: 25 },
      minutesAgo: 55,
    });

    // ── Coverage ──────────────────────────────────────────────────────────
    await seed({
      key: "full",
      query: "bun neon drizzle",
      terms: 3,
      best: 3,
      hits: 5,
      minutesAgo: 54,
    });
    // I: covers a quarter of a four-term query → "thin", a failure by the
    //    failures predicate even though it returned rows.
    await seed({
      key: "thin",
      query: "vault encryption search passphrase",
      terms: 4,
      best: 1,
      hits: 6,
      minutesAgo: 53,
    });
    // J: covers exactly half → below the "thin" bar, so NOT a failure. This is
    //    the row that keeps the failure queue from filling with healthy searches.
    await seed({
      key: "half",
      query: "sepia docs version manifest",
      terms: 4,
      best: 2,
      hits: 6,
      minutesAgo: 52,
    });
    // H: the empty-query recent-items path — terms 0, must not count as a
    //    0-of-N miss and must not enter the coverage average.
    await seed({
      key: "recent-list",
      query: "",
      terms: 0,
      best: 0,
      hits: 3,
      minutesAgo: 51,
    });

    // ── Session-scoped loops ──────────────────────────────────────────────
    // retry: a zero followed 60 s later by another search → the honest
    // "that failed, I tried again" signal.
    await seed({
      key: "retry-before",
      query: "upgrade copilot models",
      terms: 4,
      best: 0,
      hits: 0,
      session: "sess-retry",
      minutesAgo: 20,
    });
    await seed({
      key: "retry-after",
      query: "copilot",
      terms: 1,
      best: 1,
      hits: 3,
      session: "sess-retry",
      minutesAgo: 19,
    });
    // ok chain: two successful searches 60 s apart → chained, but no failure.
    await seed({
      key: "chain-1",
      query: "bun neon",
      terms: 2,
      best: 2,
      hits: 4,
      session: "sess-ok",
      minutesAgo: 20,
    });
    await seed({
      key: "chain-2",
      query: "neon pooling",
      terms: 2,
      best: 2,
      hits: 4,
      session: "sess-ok",
      minutesAgo: 19,
    });
    // Engine split, >120 s apart so neither counts as a follow-up. bm25 was
    // ASKED FOR; coverage is what the server default served.
    await seed({
      key: "engine-requested",
      query: "twinkleplop animation",
      terms: 2,
      best: 2,
      hits: 5,
      engine: "bm25",
      options: { limit: DEFAULT_LIMIT, engine: "bm25" },
      session: "sess-engine",
      minutesAgo: 40,
    });
    await seed({
      key: "engine-default",
      query: "bun deploy",
      terms: 2,
      best: 1,
      hits: 5,
      engine: "coverage",
      session: "sess-engine",
      minutesAgo: 35,
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (ownerId) await conn.delete(users).where(eq(users.id, ownerId));
  });

  test("an empty result is classified, and the three classes sum to it", async () => {
    const s = await telemetrySummary(conn, ownerId, 30);
    expect(s.zero_result).toBe(5);
    expect(s.zero_bare).toBe(2); // bare + the retry session's zero
    expect(s.zero_precision).toBe(2); // min_terms did its job
    expect(s.zero_filtered).toBe(1); // the scope did it
    expect(s.zero_unknown).toBe(0); // every seeded row carries options
    expect(
      s.zero_bare + s.zero_precision + s.zero_filtered + s.zero_unknown,
    ).toBe(s.zero_result);
  });

  test("truncation is read against the REQUESTED page size", async () => {
    const s = await telemetrySummary(conn, ownerId, 30);
    // Only E hit its own limit; F's 10 hits came out of a request for 25.
    expect(s.truncated).toBe(1);
  });

  test("coverage ignores the recent-items path", async () => {
    const s = await telemetrySummary(conn, ownerId, 30);
    // 15 searches carry terms (16 seeded minus the empty-q row).
    expect(s.searches).toBe(16);
    expect(s.coveraged_searches).toBe(15);
    expect(s.full_coverage).toBe(6);
    expect(s.avg_coverage).toBe(0.52); // 7.75 / 15
  });

  test("a retry counts only after an actual zero", async () => {
    const s = await telemetrySummary(conn, ownerId, 30);
    expect(s.reformulated).toBe(2); // both chains are 60 s apart
    expect(s.retried_after_zero).toBe(1); // only the retry chain
  });

  test("the engine split exposes self-selected traffic", async () => {
    const s = await telemetrySummary(conn, ownerId, 30);
    const bm25 = s.by_engine.find((e) => e.engine === "bm25");
    const coverage = s.by_engine.find((e) => e.engine === "coverage");
    expect(bm25?.searches).toBe(1);
    expect(bm25?.explicit).toBe(1); // asked for → not comparable as an A/B
    expect(coverage?.searches).toBe(5);
    expect(coverage?.explicit).toBe(0); // served by default
  });

  test("the failure queue is empty-or-thin, not every partial search", async () => {
    const failures = await telemetryFailures(conn, ownerId, 30, 50);
    const queries = failures.map((f) => f.queryText);
    expect(failures.length).toBe(6); // 5 zeros + I
    expect(queries).toContain("vault encryption search passphrase"); // I: 1/4
    expect(queries).not.toContain("sepia docs version manifest"); // J: 2/4
    expect(queries).not.toContain("deploy pipeline notes"); // F: 1/2
  });
});

describe.skipIf(!hasDb)("recording", () => {
  let conn: Db;
  let ownerId = "";
  /** Own owner for the purge case: the throttle is per owner and process-wide,
   *  so reusing an owner would start the test already inside the interval. */
  let purgeOwnerId = "";

  beforeAll(async () => {
    conn = db();
    // Self-heal: clear rows left by an interrupted earlier run (scoped to the
    // record/purge prefixes so the summary owner is never touched mid-flight).
    await conn
      .delete(users)
      .where(like(users.email, "telemetry-suite-%@sepia.test"));
    const [owner] = await conn
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Telemetry Record",
        email: RECORD_EMAIL,
      })
      .returning({ id: users.id });
    ownerId = String(owner!.id);
    const [purgeOwner] = await conn
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Telemetry Purge",
        email: PURGE_EMAIL,
      })
      .returning({ id: users.id });
    purgeOwnerId = String(purgeOwner!.id);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await conn
      .delete(users)
      .where(inArray(users.email, [RECORD_EMAIL, PURGE_EMAIL]));
  });

  async function lastEvent() {
    const [row] = await conn
      .select()
      .from(telemetryEvents)
      .where(eq(telemetryEvents.ownerId, ownerId))
      .orderBy(desc(telemetryEvents.createdAt))
      .limit(1);
    return row;
  }

  test("query text never reaches options, even when the input carries it", () => {
    // Parsing through SearchInput is what both writers do; `q` is present in
    // the value and must still be absent from what gets stored.
    const input = v.parse(SearchInput, {
      q: "the secret question",
      limit: 5,
      min_terms: 2,
      namespace: "personal",
      engine: "bm25",
    });
    const options = searchOptions(input);
    expect(options).toEqual({
      limit: 5,
      min_terms: 2,
      namespace: "personal",
      engine: "bm25",
    });
    expect(Object.keys(options)).not.toContain("q");
  });

  test("an unset option is absent rather than a null sentinel", () => {
    expect(searchOptions({})).toEqual({ limit: 10 });
    expect(searchOptions({ tags: [] })).toEqual({ limit: 10 });
    expect(searchOptions({ tags: ["a", "b"] })).toEqual({
      limit: 10,
      tags: ["a", "b"],
    });
  });

  test("below transcripts the payload is dropped but options are kept", async () => {
    await setTelemetrySettings(conn, ownerId, { tier: "signals", ttlDays: 30 });
    await recordTelemetry(conn, {
      ownerId,
      tool: "search",
      queryText: "raw query text must not land",
      hitIds: ["00000000-0000-0000-0000-000000000000"],
      options: searchOptions({ limit: 10, min_terms: 3 }),
      terms: ["alpha"],
      hitCount: 0,
    });
    const row = await lastEvent();
    expect(row?.queryText).toBeNull();
    expect(row?.hitIds).toBeNull();
    expect(row?.options).toEqual({ limit: 10, min_terms: 3 });
  });

  test("at transcripts both halves are stored", async () => {
    await setTelemetrySettings(conn, ownerId, {
      tier: "transcripts",
      ttlDays: 30,
    });
    await recordTelemetry(conn, {
      ownerId,
      tool: "search",
      queryText: "raw query text is allowed here",
      options: searchOptions({ limit: 10 }),
      terms: ["alpha"],
      hitCount: 1,
    });
    const row = await lastEvent();
    expect(row?.queryText).toBe("raw query text is allowed here");
    expect(row?.options).toEqual({ limit: 10 });
  });

  test("off records nothing at all", async () => {
    await setTelemetrySettings(conn, ownerId, { tier: "off", ttlDays: 30 });
    const before = await lastEvent();
    await recordTelemetry(conn, { ownerId, tool: "search", terms: ["a"] });
    const after = await lastEvent();
    expect(after?.id).toBe(before?.id);
  });

  test("expired payloads are purged opportunistically, at most once a run", async () => {
    await setTelemetryTtl(conn, purgeOwnerId, 1); // tier stays off: no recording
    /** Seed a row that is older than the TTL; return its id. */
    const old = async () => {
      const [row] = await conn
        .insert(telemetryEvents)
        .values({
          ownerId: purgeOwnerId,
          tool: "search",
          queryText: "text older than the ttl",
          createdAt: new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString(),
        })
        .returning({ id: telemetryEvents.id });
      return String(row!.id);
    };
    const textOf = async (id: string) => {
      const [row] = await conn
        .select()
        .from(telemetryEvents)
        .where(eq(telemetryEvents.id, id));
      return row?.queryText ?? null;
    };

    const first = await old();
    await maybePurgeExpiredTelemetry(conn, purgeOwnerId, 1_000);
    expect(await textOf(first)).toBeNull();

    // Within the interval: throttled, so the payload survives this call…
    const second = await old();
    await maybePurgeExpiredTelemetry(conn, purgeOwnerId, 1_001);
    expect(await textOf(second)).toBe("text older than the ttl");

    // …and is cleared once the interval has elapsed.
    await maybePurgeExpiredTelemetry(
      conn,
      purgeOwnerId,
      1_000 + PURGE_INTERVAL_MS + 1,
    );
    expect(await textOf(second)).toBeNull();
  });
});
