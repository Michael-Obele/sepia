import type { Db } from "../client.ts";
import { and, eq, sql } from "drizzle-orm";
import { entities, memories, namespaces, relations } from "../schema.ts";
import { STALE_AFTER_DAYS, STALE_IMPORTANCE } from "../../types.ts";

export interface Stats {
  namespaces: number;
  entities: number;
  memories: number;
  relations: number;
  /** Conversation digests (tag `conversation` + metadata.kind = "conversation"). */
  conversations: number;
  archived: number;
  /** Memories by type (fact/observation/preference/instruction). */
  memories_by_type: Record<string, number>;
  /** Entities by type. */
  entities_by_type: Record<string, number>;
  /** Top entities by access_count (most-viewed). */
  top_entities: Array<{
    id: string;
    name: string;
    type: string;
    access_count: number;
    importance: number;
  }>;
  /** Memories that would be archived by the next prune_memories sweep. */
  decay_candidates: number;
  /** Most recently updated memories (for the home feed). */
  recent_memories: Array<{
    id: string;
    content: string;
    type: string;
    importance: number;
    namespace: string;
    updated_at: string;
  }>;
}

/** Dashboard stats: counts, top entities, decay candidates, recent feed. */
export async function getStats(db: Db, ownerId: string): Promise<Stats> {
  // All 11 queries in ONE Neon HTTP round trip via db.batch. Firing them as
  // separate requests (even via Promise.all) costs ~500-700ms each through the
  // Neon HTTP driver, so getStats used to take ~10s. A single batch is ~1s.
  // Every query is scoped to the owner's namespaces.
  const owned = sql`(SELECT id FROM ${namespaces} WHERE owner_id = ${ownerId})`;
  // The array is passed INLINE to db.batch — never hoisted into a typed
  // `BatchItem<"pg">[]` variable and then re-cast. Hoisting widens every element
  // to one generic shape, which erases each query's result type and lets the
  // destructuring below drift out of order WITHOUT a compile error. That is how
  // `recent`/`conv` were silently swapped (they read each other's results, so
  // the feed showed a phantom memory and `conversations` always read 0).
  // Inlined, TypeScript infers the tuple and checks the order for us.
  const [
    // ORDER MUST MATCH THE ARRAY BELOW, position for position:
    ns, // 1  namespace count
    ent, // 2  entity count
    mem, // 3  memory count
    rel, // 4  relation count
    archived, // 5  archived memory count
    memByType, // 6  memories grouped by type
    entByType, // 7  entities grouped by type
    top, // 8  top entities by access_count
    decay, // 9  prune candidates (raw SQL)
    conv, // 10 conversation digests
    recent, // 11 most recently updated memories
  ] = await db.batch([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(namespaces)
      .where(eq(namespaces.ownerId, ownerId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(entities)
      .where(sql`${entities.namespaceId} IN ${owned}`),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(memories)
      .where(sql`${memories.namespaceId} IN ${owned}`),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(relations)
      .where(sql`${relations.namespaceId} IN ${owned}`),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(memories)
      .where(
        and(
          eq(memories.archived, true),
          sql`${memories.namespaceId} IN ${owned}`,
        ),
      ),
    db
      .select({ type: memories.type, n: sql<number>`count(*)::int` })
      .from(memories)
      .where(sql`${memories.namespaceId} IN ${owned}`)
      .groupBy(memories.type),
    db
      .select({ type: entities.type, n: sql<number>`count(*)::int` })
      .from(entities)
      .where(sql`${entities.namespaceId} IN ${owned}`)
      .groupBy(entities.type),
    db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        access_count: entities.accessCount,
        importance: entities.importance,
      })
      .from(entities)
      .where(sql`${entities.namespaceId} IN ${owned}`)
      .orderBy(sql`${entities.accessCount} DESC`)
      .limit(8),
    db.execute(sql`
        SELECT count(*)::int AS n FROM ${memories}
        WHERE NOT archived
          AND importance < ${STALE_IMPORTANCE}
          AND updated_at < now() - (${STALE_AFTER_DAYS} * interval '1 day')
          AND namespace_id IN (SELECT id FROM ${namespaces} WHERE owner_id = ${ownerId})
      `),
    // Conversation digests only — constituents carry metadata.kind too, but
    // only the digest carries the `conversation` tag (matches the dashboard
    // conversations list filter). Uses the GIN tag index.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(memories)
      .where(
        sql`${memories.metadata} @> '{"kind":"conversation"}'::jsonb AND ${memories.tags} @> ARRAY['conversation'] AND ${memories.namespaceId} IN ${owned}`,
      ),
    db
      .select({
        id: memories.id,
        content: memories.content,
        type: memories.type,
        importance: memories.importance,
        namespace: namespaces.name,
        updated_at: memories.updatedAt,
      })
      .from(memories)
      .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
      .where(and(eq(memories.archived, false), eq(namespaces.ownerId, ownerId)))
      .orderBy(sql`${memories.updatedAt} DESC`)
      .limit(10),
  ]);

  const memoriesByType: Record<string, number> = {};
  for (const r of memByType) memoriesByType[String(r.type)] = Number(r.n);
  const entitiesByType: Record<string, number> = {};
  for (const r of entByType) entitiesByType[String(r.type)] = Number(r.n);

  return {
    namespaces: Number(ns[0]?.n ?? 0),
    entities: Number(ent[0]?.n ?? 0),
    memories: Number(mem[0]?.n ?? 0),
    relations: Number(rel[0]?.n ?? 0),
    conversations: Number(conv[0]?.n ?? 0),
    archived: Number(archived[0]?.n ?? 0),
    memories_by_type: memoriesByType,
    entities_by_type: entitiesByType,
    top_entities: top.map(
      (e: {
        id: unknown;
        name: unknown;
        type: unknown;
        access_count: unknown;
        importance: unknown;
      }) => ({
        id: String(e.id),
        name: String(e.name),
        type: String(e.type),
        access_count: Number(e.access_count),
        importance: Number(e.importance),
      }),
    ),
    decay_candidates: Number(decay.rows[0]?.n ?? 0),
    // No `?? ""` fallbacks on `id`: a missing id here means the batch results are
    // out of order, and coercing it to "" is what turned that into a fabricated
    // row the UI then tried to DELETE (empty string is not a uuid → 500).
    recent_memories: recent.map((m) => ({
      id: m.id,
      content: m.content,
      // `type`, `importance` and `updated_at` are nullable columns, unlike
      // id/content/namespace — those three are the only defaults needed.
      type: m.type ?? "",
      importance: m.importance ?? 0,
      namespace: m.namespace,
      updated_at: m.updated_at ?? "",
    })),
  };
}
