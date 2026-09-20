/**
 * getStats() tests — the dashboard home feed.
 *
 * WHY THESE EXIST: `getStats` is the one place that reads ELEVEN queries out of a
 * single `db.batch()` BY POSITION. On 2026-09-20 the destructuring drifted out of
 * sync with the query order — `recent` and `conv` were read as each other's
 * results — and because the mapper then coerced every missing field with `?? ""`,
 * it did not fail. It fabricated ONE phantom "recent memory" with an empty id;
 * the dashboard rendered it as `— · 0%`, and the delete button sent `id = ""`
 * straight to Postgres: `invalid input syntax for type uuid: ""` → 500.
 * The order is now checked by the compiler (the batch array is passed inline to
 * `db.batch`, so each result keeps its own type), so these tests pin the
 * BEHAVIOUR: a future reordering has to fail loudly here instead of silently in
 * the UI.
 *
 * The load-bearing assertions are therefore:
 *   1. every `recent_memories` row has a real uuid and real fields — no phantom,
 *   2. `recent_memories` is ordered newest-first and holds actual memory content,
 *   3. `conversations` counts conversation digests (it read 0 for weeks),
 *   4. counts stay scoped to the owner,
 *   5. the id the feed hands the UI is deletable (the reported 500).
 *
 * SAFETY: same throwaway-owner pattern as search.test.ts / briefing.test.ts —
 * fixtures live under `stats-suite+<run>@sepia.test` and are deleted in
 * `afterAll` (users → namespaces → memories/entities all cascade). The self-heal
 * only touches runs older than an hour and is scoped to this suite's own email
 * pattern; an unscoped DELETE would nuke another run's fixtures mid-flight on the
 * live database. Without DATABASE_URL the whole file skips.
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
import { getStats } from "./stats.ts";
import { deleteMemory } from "./memories.ts";
import { UUID_RE } from "./util.ts";

const hasDb = Boolean(process.env.DATABASE_URL);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = `stats-suite+${RUN}@sepia.test`;
const OTHER_EMAIL = `stats-suite-other+${RUN}@sepia.test`;
const NS_MAIN = "stats-suite";
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

const test = (name: string, fn: () => void | Promise<unknown>) =>
  bunTest(name, fn, TEST_TIMEOUT_MS);

/** Explicit timestamps: `order by updated_at desc` needs distinct values. */
const at = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

describe.skipIf(!hasDb)("getStats", () => {
  let conn: Db;
  let ownerId = "";
  let otherId = "";
  let nsId = "";
  let otherNsId = "";
  /** oldest → newest, matching the expected `recent_memories` order. */
  const seeded: string[] = [];
  let digestId = "";
  let deleteTargetId = "";

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
          like(users.email, "stats-suite%@sepia.test"),
          lt(users.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );

    ownerId = await seedOwner(OWNER_EMAIL, "Stats Suite");
    otherId = await seedOwner(OTHER_EMAIL, "Stats Suite Other");
    nsId = await seedNs(ownerId, NS_MAIN);
    otherNsId = await seedNs(otherId, NS_MAIN);

    const rows = await conn
      .insert(memories)
      .values([
        {
          namespaceId: nsId,
          type: "fact",
          importance: 0.6,
          content: "stats-suite oldest",
          updatedAt: at(3),
        },
        {
          namespaceId: nsId,
          type: "observation",
          importance: 0.7,
          content: "stats-suite middle",
          updatedAt: at(2),
        },
        {
          namespaceId: nsId,
          type: "preference",
          importance: 0.8,
          content: "stats-suite newest",
          updatedAt: at(1),
        },
        {
          namespaceId: nsId,
          type: "observation",
          importance: 0.4,
          content: "stats-suite delete me",
          updatedAt: at(4),
        },
      ])
      .returning({ id: memories.id });
    seeded.push(...rows.map((r) => String(r.id)));
    deleteTargetId = seeded[3]!;

    // A conversation digest: the counts differ from `recent_memories`, which is
    // exactly how the two queries were confused with one another.
    const [digest] = await conn
      .insert(memories)
      .values({
        namespaceId: nsId,
        type: "observation",
        importance: 0.85,
        content: "stats-suite conversation digest",
        tags: ["conversation"],
        metadata: { kind: "conversation" },
        updatedAt: at(5),
      })
      .returning({ id: memories.id });
    digestId = String(digest!.id);

    await conn.insert(entities).values({
      namespaceId: nsId,
      name: "stats-suite entity",
      type: "concept",
      summary: "fixture",
    });

    // ── Another tenant: must never leak into the owner's stats ──
    await conn.insert(memories).values({
      namespaceId: otherNsId,
      type: "fact",
      importance: 0.99,
      content: "other tenant secret memory",
      updatedAt: at(1),
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!conn) return;
    await conn
      .delete(users)
      .where(inArray(users.email, [OWNER_EMAIL, OTHER_EMAIL]));
  }, SETUP_TIMEOUT_MS);

  // ── The regression: a fabricated row the UI is then told to delete ───────
  test("recent_memories holds real memories, never a phantom row", async () => {
    const s = await getStats(conn, ownerId);
    expect(s.recent_memories.length).toBeGreaterThan(0);
    for (const m of s.recent_memories) {
      // An empty id is the phantom: it reaches Postgres as `id = ''`, which is
      // not a uuid, so the delete 500s instead of returning 404.
      expect(UUID_RE.test(m.id)).toBe(true);
      expect(m.content).not.toBe("");
      expect(m.namespace).toBe(NS_MAIN);
      expect(m.updated_at).not.toBe("");
      expect(Number.isFinite(m.importance)).toBe(true);
    }
  });

  test("recent_memories is newest-first and scoped to the owner", async () => {
    const s = await getStats(conn, ownerId);
    expect(s.recent_memories.map((m) => m.content)).toEqual([
      "stats-suite newest",
      "stats-suite middle",
      "stats-suite oldest",
      "stats-suite delete me",
      "stats-suite conversation digest",
    ]);
    expect(
      s.recent_memories.some((m) => m.content.includes("other tenant")),
    ).toBe(false);
    expect(s.recent_memories.find((m) => m.id === digestId)?.content).toBe(
      "stats-suite conversation digest",
    );
  });

  test("conversations counts digests, not recent memories", async () => {
    const s = await getStats(conn, ownerId);
    // Read as 0 for weeks while it was reading `recent`'s result: a count query
    // returns one `{ n }` row, which the type-blind mapper turned into a phantom.
    expect(s.conversations).toBe(1);
    expect(s.recent_memories.length).toBe(5);
  });

  test("counts are scoped to the owner", async () => {
    const s = await getStats(conn, ownerId);
    expect(s.namespaces).toBe(1);
    expect(s.memories).toBe(5);
    expect(s.entities).toBe(1);
    expect(s.relations).toBe(0);
    expect(s.memories_by_type).toEqual({
      fact: 1,
      observation: 3,
      preference: 1,
    });
    expect(s.top_entities.map((e) => e.name)).toEqual(["stats-suite entity"]);

    // The other tenant sees only its own single memory.
    const other = await getStats(conn, otherId);
    expect(other.memories).toBe(1);
    expect(other.conversations).toBe(0);
    expect(other.recent_memories.map((m) => m.content)).toEqual([
      "other tenant secret memory",
    ]);
  });

  // ── The reported 500, end to end: whatever id the feed shows must delete ──
  // MUST stay last: it removes a fixture the assertions above count on.
  test("the id the feed hands the UI is deletable", async () => {
    const s = await getStats(conn, ownerId);
    const target = s.recent_memories.find((m) => m.id === deleteTargetId);
    expect(target?.content).toBe("stats-suite delete me");
    const deleted = await deleteMemory(conn, ownerId, target!.id);
    expect(deleted.id).toBe(deleteTargetId);
    const after = await getStats(conn, ownerId);
    expect(after.memories).toBe(4);
    expect(after.recent_memories.map((m) => m.id)).not.toContain(
      deleteTargetId,
    );
  });
});
