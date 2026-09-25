/**
 * Standing-rules briefing tests — `getBriefing()`.
 *
 * WHY THESE EXIST: a standing constraint cannot be found by relevance search, because
 * relevance is computed against a task that has not been scoped yet. "Warn before large
 * downloads" only helps if it is already in context. So the briefing is the one read that
 * must happen unconditionally at the start of a session, and it must be trustworthy in two
 * specific ways:
 *   1. CORE IS NEVER DROPPED FOR BUDGET. Core = tagged `always` and ONLY that (tag-only
 *      membership since 2026-09-24 — importance ranks rows, it never admits one). The
 *      predicate is asserted directly rather than assumed.
 *   2. TRUNCATION IS REPORTED, NEVER IMPLIED. The failure being fixed is a *silent* subset:
 *      a model that cannot tell what it did not see. `omitted` must therefore be exact.
 *
 * SAFETY: same throwaway-owner pattern as search.test.ts / filters.test.ts — fixtures live
 * under `briefing-suite+<run>@sepia.test` and are deleted in `afterAll` (users → namespaces →
 * memories cascade). The self-heal only touches runs older than an hour, and is scoped to
 * this suite's own email pattern; an unscoped DELETE here would nuke another run's fixtures
 * mid-flight on the live database. Without DATABASE_URL the whole file skips.
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
import { memories, namespaces, users } from "../schema.ts";
import {
  BRIEFING_CHARS_DEFAULT,
  BRIEFING_ITEM_CHARS,
  CORE_IMPORTANCE,
} from "../../types.ts";
import { getBriefing } from "./memories.ts";

const hasDb = Boolean(process.env.DATABASE_URL);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = `briefing-suite+${RUN}@sepia.test`;
const OTHER_EMAIL = `briefing-suite-other+${RUN}@sepia.test`;
const NS_MAIN = "briefing-suite";
const NS_BUDGET = "briefing-budget";
const NS_CORE = "briefing-core";
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

const test = (name: string, fn: () => void | Promise<unknown>) =>
  bunTest(name, fn, TEST_TIMEOUT_MS);

/** Exactly `total` chars, so budget arithmetic in the assertions is not a guess. */
const pad = (head: string, total: number) =>
  head + "x".repeat(Math.max(total - head.length, 0));

describe.skipIf(!hasDb)("briefing", () => {
  let conn: Db;
  let ownerId = "";
  let otherId = "";
  let nsMain = "";
  let nsBudget = "";
  let nsCore = "";
  const ids = new Map<string, string>();

  function id(key: string): string {
    const value = ids.get(key);
    if (!value) throw new Error(`fixture '${key}' was never seeded`);
    return value;
  }

  async function seedOwner(email: string, name: string) {
    const [row] = await conn
      .insert(users)
      .values({ id: crypto.randomUUID(), name, email })
      .returning({ id: users.id });
    return String(row!.id);
  }

  async function seedNs(owner: string, name: string) {
    const [row] = await conn
      .insert(namespaces)
      .values({ ownerId: owner, name, description: "test" })
      .returning({ id: namespaces.id });
    return String(row!.id);
  }

  beforeAll(async () => {
    conn = db();

    // Self-heal only long-dead runs; never another live run's fixtures.
    await conn
      .delete(users)
      .where(
        and(
          like(users.email, "briefing-suite%@sepia.test"),
          lt(users.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );

    ownerId = await seedOwner(OWNER_EMAIL, "Briefing Suite");
    otherId = await seedOwner(OTHER_EMAIL, "Briefing Suite Other");
    nsMain = await seedNs(ownerId, NS_MAIN);
    nsBudget = await seedNs(ownerId, NS_BUDGET);
    nsCore = await seedNs(ownerId, NS_CORE);

    // ── Main namespace: ordering, the core predicate, the type escape hatch ──
    const main = await conn
      .insert(memories)
      .values([
        {
          namespaceId: nsMain,
          type: "instruction",
          importance: 0.95,
          // The regression this suite exists for: 0.95 with NO tag used to be core via
          // the old `OR importance >= 0.9` half. Tag-only membership puts it in the tail.
          content: "high-importance rule that is not tagged",
        },
        {
          namespaceId: nsMain,
          type: "instruction",
          importance: 0.7,
          tags: ["always"],
          content: "global rule that is tagged always",
        },
        {
          namespaceId: nsMain,
          type: "preference",
          importance: 0.7,
          content: "ordinary preference",
        },
        {
          namespaceId: nsMain,
          type: "instruction",
          importance: 0.6,
          content: "ordinary instruction",
        },
        {
          namespaceId: nsMain,
          type: "fact",
          importance: 0.5,
          tags: ["always"],
          content: "pinned fact, explicitly always",
        },
        {
          // Higher importance than every standing rule, but a fact and untagged: the
          // briefing covers behaviour, not knowledge, so this must NOT appear.
          namespaceId: nsMain,
          type: "fact",
          importance: 0.99,
          content: "high-importance fact that is not a standing rule",
        },
        {
          namespaceId: nsMain,
          type: "instruction",
          importance: 0.95,
          archived: true,
          content: "archived core rule must not appear",
        },
        {
          namespaceId: nsMain,
          type: "instruction",
          importance: 0.8,
          content: pad("long standing rule", 1000),
        },
      ])
      .returning({ id: memories.id });
    const mainKeys = [
      "HIGH_UNTAGGED",
      "ALWAYS_LOW",
      "MID",
      "OTHER",
      "FACT_ALWAYS",
      "FACT_HIGH",
      "ARCHIVED_CORE",
      "LONG",
    ];
    mainKeys.forEach((key, i) => ids.set(key, String(main[i]!.id)));

    // ── Budget namespace: 1 core + four 300-char rules at descending importance ──
    const budget = await conn
      .insert(memories)
      .values([
        {
          namespaceId: nsBudget,
          type: "instruction",
          importance: 0.95,
          tags: ["always"],
          content: "BUDGET-CORE",
        },
        ...[0.74, 0.73, 0.72, 0.71].map((importance, i) => ({
          namespaceId: nsBudget,
          type: "instruction",
          importance,
          content: pad(`budget-rule-${i}`, 300),
        })),
      ])
      .returning({ id: memories.id });
    ["B_CORE", "B1", "B2", "B3", "B4"].forEach((key, i) =>
      ids.set(key, String(budget[i]!.id)),
    );

    // ── Core namespace: three long core rules that together exceed the minimum budget ──
    const core = await conn
      .insert(memories)
      .values(
        [0.95, 0.94, 0.93].map((importance, i) => ({
          namespaceId: nsCore,
          type: "instruction",
          importance,
          tags: ["always"],
          content: pad(`core-rule-${i}`, 1000),
        })),
      )
      .returning({ id: memories.id });
    ["C1", "C2", "C3"].forEach((key, i) => ids.set(key, String(core[i]!.id)));

    // ── Another tenant: must never leak into the owner's briefing ──
    const otherNs = await seedNs(otherId, NS_MAIN);
    await conn.insert(memories).values({
      namespaceId: otherNs,
      type: "instruction",
      importance: 0.99,
      tags: ["always"],
      content: "other tenant secret rule",
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!conn) return;
    await conn
      .delete(users)
      .where(inArray(users.email, [OWNER_EMAIL, OTHER_EMAIL]));
  }, SETUP_TIMEOUT_MS);

  // ── Ordering: core first, then priority ─────────────────────────────────
  test("core rules come first, then the rest by importance", async () => {
    const b = await getBriefing(conn, ownerId, {
      namespace: NS_MAIN,
      detail: "all",
    });
    expect(b.memories.map((m) => m.id)).toEqual([
      id("ALWAYS_LOW"),
      id("FACT_ALWAYS"),
      id("HIGH_UNTAGGED"),
      id("LONG"),
      id("MID"),
      id("OTHER"),
    ]);
    expect(b.count).toBe(6);
    expect(b.core_count).toBe(2);
    expect(b.truncated).toBe(false);
    expect(b.omitted).toBe(0);
  });

  // ── The default scope: core only, tail counted but not returned ─────────
  test("defaults to core: the tail is not returned, but is counted", async () => {
    const b = await getBriefing(conn, ownerId, { namespace: NS_MAIN });
    expect(b.detail).toBe("core");
    expect(b.memories.map((m) => m.id)).toEqual([
      id("ALWAYS_LOW"),
      id("FACT_ALWAYS"),
    ]);
    expect(b.count).toBe(2);
    expect(b.core_count).toBe(2);
    expect(b.other_standing).toBe(4);
    // Nothing was left out of what was ASKED for, so the flag stays quiet. If `truncated`
    // were always true the caller would habituate to it and it would stop being read.
    expect(b.truncated).toBe(false);
    expect(b.omitted).toBe(0);
    expect(b.max_chars).toBeUndefined();
  });

  test("core mode ignores max_chars: core is never dropped for budget", async () => {
    const tiny = await getBriefing(conn, ownerId, {
      namespace: NS_MAIN,
      detail: "core",
      max_chars: 1000,
    });
    const dflt = await getBriefing(conn, ownerId, { namespace: NS_MAIN });
    expect(tiny.memories).toEqual(dflt.memories);
    expect(tiny.max_chars).toBeUndefined();
    expect(tiny.other_standing).toBe(4);
  });

  test("all mode adds the tail, and reports the budget it used", async () => {
    const b = await getBriefing(conn, ownerId, {
      namespace: NS_MAIN,
      detail: "all",
    });
    expect(b.detail).toBe("all");
    expect(b.count).toBe(6);
    expect(b.core_count).toBe(2);
    expect(b.other_standing).toBe(4);
    expect(b.truncated).toBe(false);
    expect(b.max_chars).toBe(BRIEFING_CHARS_DEFAULT);
  });

  test("high importance WITHOUT the tag is NOT core (tag-only membership)", async () => {
    const b = await getBriefing(conn, ownerId, { namespace: NS_MAIN });
    const high = b.memories.find((m) => m.id === id("HIGH_UNTAGGED"));
    // Absent from the default (core) slice entirely — it lives in the tail.
    expect(high).toBeUndefined();
    const all = await getBriefing(conn, ownerId, {
      namespace: NS_MAIN,
      detail: "all",
    });
    const tail = all.memories.find((m) => m.id === id("HIGH_UNTAGGED"));
    expect(tail?.core).toBe(false);
    expect(tail?.tags).toEqual([]);
    // Importance still ranks — it is the top of the tail — it just no longer admits.
    expect(tail?.importance ?? 0).toBeGreaterThanOrEqual(CORE_IMPORTANCE);
  });

  test("the always tag promotes a low-importance rule above untagged ones", async () => {
    const b = await getBriefing(conn, ownerId, {
      namespace: NS_MAIN,
      detail: "all",
    });
    const order = b.memories.map((m) => m.id);
    expect(order.indexOf(id("ALWAYS_LOW"))).toBeLessThan(
      order.indexOf(id("MID")),
    );
    expect(b.memories.find((m) => m.id === id("ALWAYS_LOW"))?.core).toBe(true);
    // Same importance as MID, so only the core flag can produce this order.
    expect(b.memories.find((m) => m.id === id("ALWAYS_LOW"))?.importance).toBe(
      b.memories.find((m) => m.id === id("MID"))?.importance,
    );
  });

  // ── The type filter, and its escape hatch ───────────────────────────────
  test("facts are excluded, unless explicitly tagged always", async () => {
    const b = await getBriefing(conn, ownerId, { namespace: NS_MAIN });
    const returned = new Set(b.memories.map((m) => m.id));
    expect(returned.has(id("FACT_ALWAYS"))).toBe(true);
    // 0.99 — the highest importance in the namespace — is still not a standing rule.
    expect(returned.has(id("FACT_HIGH"))).toBe(false);
  });

  test("archived rules are excluded even when core", async () => {
    const b = await getBriefing(conn, ownerId, { namespace: NS_MAIN });
    expect(b.memories.map((m) => m.id)).not.toContain(id("ARCHIVED_CORE"));
  });

  // ── Compaction ─────────────────────────────────────────────────────────
  test("long rules are compacted, and stay reachable by id", async () => {
    const b = await getBriefing(conn, ownerId, {
      namespace: NS_MAIN,
      detail: "all",
    });
    const long = b.memories.find((m) => m.id === id("LONG"));
    expect(long?.content.length).toBe(BRIEFING_ITEM_CHARS);
    expect(long?.content.endsWith("…")).toBe(true);
    // Identity survives compaction: the full text is one `action=get` away.
    expect(long?.id).toBe(id("LONG"));
  });

  // ── Budget honesty ─────────────────────────────────────────────────────
  test("exceeding the budget reports it exactly, and drops the lowest priority first", async () => {
    const b = await getBriefing(conn, ownerId, {
      namespace: NS_BUDGET,
      detail: "all",
      max_chars: 1000,
    });
    expect(b.count + b.omitted).toBe(5);
    expect(b.truncated).toBe(true);
    expect(b.omitted).toBe(1);
    expect(b.core_count).toBe(1);
    const contents = b.memories.map((m) => m.content);
    expect(contents[0]).toBe("BUDGET-CORE");
    expect(contents.some((c) => c.startsWith("budget-rule-3"))).toBe(false);
    expect(contents.some((c) => c.startsWith("budget-rule-0"))).toBe(true);
  });

  test("a budget that fits reports no truncation", async () => {
    const b = await getBriefing(conn, ownerId, {
      namespace: NS_BUDGET,
      detail: "all",
      max_chars: 40_000,
    });
    expect(b.count).toBe(5);
    expect(b.omitted).toBe(0);
    expect(b.truncated).toBe(false);
  });

  test("budget: false ignores max_chars and returns the whole slice", async () => {
    const b = await getBriefing(conn, ownerId, {
      namespace: NS_BUDGET,
      detail: "all",
      max_chars: 1000,
      budget: false,
    });
    // The same 1000-char budget dropped a rule two tests above; with the budget
    // off, the caller gets everything and says so exactly.
    expect(b.count).toBe(5);
    expect(b.omitted).toBe(0);
    expect(b.truncated).toBe(false);
    expect(b.max_chars).toBeUndefined();
    expect(b.memories.some((m) => m.content.startsWith("budget-rule-3"))).toBe(
      true,
    );
  });

  test("core is never dropped for budget, even when it overflows", async () => {
    const b = await getBriefing(conn, ownerId, {
      namespace: NS_CORE,
      detail: "all",
      max_chars: 1000,
    });
    // 3 x 400 compacted chars = 1200 > the 1000 budget, yet all three survive.
    expect(b.count).toBe(3);
    expect(b.core_count).toBe(3);
    expect(b.truncated).toBe(false);
    expect(b.memories.every((m) => m.core)).toBe(true);
  });

  // ── Tenant boundary ────────────────────────────────────────────────────
  test("another owner's rules never appear", async () => {
    const b = await getBriefing(conn, ownerId);
    expect(b.memories.some((m) => m.content.includes("other tenant"))).toBe(
      false,
    );
    const mine = await getBriefing(conn, otherId, { namespace: NS_MAIN });
    expect(mine.memories.map((m) => m.content)).toEqual([
      "other tenant secret rule",
    ]);
  });
});
