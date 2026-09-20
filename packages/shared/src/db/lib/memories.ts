import type { Db } from "../client.ts";
import { MemoryError } from "../errors.ts";
import type { BatchItem } from "drizzle-orm/batch";
import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import {
  entities,
  memories,
  memoryEntityLinks,
  namespaces,
} from "../schema.ts";
import {
  ALWAYS_TAG,
  BRIEFING_CHARS_DEFAULT,
  BRIEFING_CHARS_MAX,
  BRIEFING_FETCH_MAX,
  BRIEFING_ITEM_CHARS,
  BRIEFING_TYPES,
  CORE_IMPORTANCE,
  normalizeTags,
} from "../../types.ts";
import { escapeLike, matchesAllTerms, resolveNamespaceId } from "./util.ts";
import { assertMemoryQuota } from "./plans.ts";

export interface MemoryCreate {
  content: string;
  type?: "fact" | "observation" | "preference" | "instruction";
  importance?: number;
  namespace?: string;
  entity_ids?: string[];
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface MemoryUpdate {
  content?: string;
  type?: "fact" | "observation" | "preference" | "instruction";
  importance?: number;
  metadata?: Record<string, unknown>;
  archived?: boolean;
  /** If provided, REPLACES the entity link set. */
  entity_ids?: string[];
  /** REPLACES the tag set. */
  tags?: string[];
}

/** A full memory row as stored in the DB. */
export type Memory = typeof memories.$inferSelect;

/**
 * Create a memory (optionally linked to 0-3 entities). The id is generated
 * client-side so the memory and its links insert atomically in one
 * transaction.
 */
export async function createMemory(
  db: Db,
  ownerId: string,
  input: MemoryCreate,
  source?: string,
  plan?: string | null,
): Promise<(Memory & { namespace: string }) | undefined> {
  await assertMemoryQuota(db, ownerId, plan);
  const namespaceId = await resolveNamespaceId(
    db,
    ownerId,
    input.namespace ?? "personal",
  );
  if (input.entity_ids?.length) {
    // Entities must exist AND live in the same namespace as the memory.
    const found = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          inArray(entities.id, input.entity_ids),
          eq(entities.namespaceId, namespaceId),
        ),
      );
    const foundIds = new Set(found.map((r) => String(r.id)));
    const missing = input.entity_ids.filter((id) => !foundIds.has(id));
    if (missing.length) {
      throw new MemoryError(
        "entity_not_found",
        `entity_ids refer to entities that don't exist: ${missing.join(", ")}`,
      );
    }
  }

  const id = crypto.randomUUID();
  const type = input.type ?? "fact";
  const importance = input.importance ?? 0.5;
  const metadata = input.metadata ?? {};
  const tags = normalizeTags(input.tags);

  // db.batch() = memory + link inserts in ONE Neon HTTP call (atomic).
  const queries: BatchItem<"pg">[] = [
    db.insert(memories).values({
      id,
      namespaceId,
      content: input.content,
      type,
      importance,
      source: source ?? null,
      metadata,
      tags,
    }),
    ...(input.entity_ids ?? []).map((entityId) =>
      db.insert(memoryEntityLinks).values({ memoryId: id, entityId }),
    ),
  ];
  // db.batch requires a non-empty tuple type; the array always has ≥1 item.
  await db.batch(queries as [BatchItem<"pg">, ...BatchItem<"pg">[]]);

  const rows = await db
    .select({
      ...getTableColumns(memories),
      namespace: namespaces.name,
    })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(eq(memories.id, id))
    .limit(1);
  return rows[0];
}

/** Full memory detail: memory + linked entity names. */
export async function getMemory(db: Db, ownerId: string, id: string) {
  const rows = await db
    .select({
      ...getTableColumns(memories),
      namespace: namespaces.name,
    })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(and(eq(memories.id, id), eq(namespaces.ownerId, ownerId)))
    .limit(1);
  const memory = rows[0];
  if (!memory) throw new MemoryError("not_found", `memory '${id}' not found`);
  const links = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
    })
    .from(memoryEntityLinks)
    .innerJoin(entities, eq(entities.id, memoryEntityLinks.entityId))
    .where(eq(memoryEntityLinks.memoryId, id))
    .orderBy(entities.name);
  return { ...memory, entities: links };
}

export async function updateMemory(
  db: Db,
  ownerId: string,
  id: string,
  update: MemoryUpdate,
) {
  const sets: Partial<typeof memories.$inferInsert> = {};
  if (update.content !== undefined) sets.content = update.content;
  if (update.type !== undefined) sets.type = update.type;
  if (update.importance !== undefined) sets.importance = update.importance;
  if (update.metadata !== undefined) sets.metadata = update.metadata;
  if (update.archived !== undefined) sets.archived = update.archived;
  if (update.tags !== undefined) sets.tags = normalizeTags(update.tags);

  const owned = db
    .select({ id: namespaces.id })
    .from(namespaces)
    .where(eq(namespaces.ownerId, ownerId));

  const queries: BatchItem<"pg">[] = [];
  if (Object.keys(sets).length > 0) {
    queries.push(
      db
        .update(memories)
        .set({ ...sets, updatedAt: sql`now()` })
        .where(and(eq(memories.id, id), inArray(memories.namespaceId, owned))),
    );
  }
  if (update.entity_ids !== undefined) {
    // Verify the target entities exist before replacing the link set.
    if (update.entity_ids.length) {
      const found = await db
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            inArray(entities.id, update.entity_ids),
            // Same namespace as the memory being updated.
            eq(
              entities.namespaceId,
              sql`(SELECT namespace_id FROM memories WHERE id = ${id})`,
            ),
          ),
        );
      const foundIds = new Set(found.map((r) => String(r.id)));
      const missing = update.entity_ids.filter((x) => !foundIds.has(x));
      if (missing.length) {
        throw new MemoryError(
          "entity_not_found",
          `entity_ids refer to entities that don't exist: ${missing.join(", ")}`,
        );
      }
    }
    queries.push(
      db.delete(memoryEntityLinks).where(eq(memoryEntityLinks.memoryId, id)),
    );
    for (const entityId of update.entity_ids) {
      queries.push(
        db.insert(memoryEntityLinks).values({ memoryId: id, entityId }),
      );
    }
  }
  if (queries.length === 0) {
    throw new MemoryError("invalid_input", "no fields to update");
  }
  await db.batch(queries as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
  return getMemory(db, ownerId, id);
}

export async function deleteMemory(db: Db, ownerId: string, id: string) {
  const owned = db
    .select({ id: namespaces.id })
    .from(namespaces)
    .where(eq(namespaces.ownerId, ownerId));
  const res = await db
    .delete(memories)
    .where(and(eq(memories.id, id), inArray(memories.namespaceId, owned)))
    .returning({ id: memories.id });
  const row = res[0];
  if (!row) throw new MemoryError("not_found", `memory '${id}' not found`);
  return row;
}

export interface MemoryQueryFilters {
  type?: "fact" | "observation" | "preference" | "instruction";
  namespace?: string;
  importance_min?: number;
  archived?: boolean;
  /** match memories carrying ALL of these tags */
  tags?: string[];
  /** free-text search over memory content (case-insensitive substring) */
  q?: string;
  limit?: number;
  offset?: number;
}

/** Query memories: ordered by importance DESC, then updated_at DESC. */
export async function queryMemories(
  db: Db,
  ownerId: string,
  filters: MemoryQueryFilters = {},
) {
  const conditions = [
    eq(memories.archived, filters.archived ?? false),
    eq(namespaces.ownerId, ownerId),
  ];
  if (filters.type !== undefined) {
    conditions.push(eq(memories.type, filters.type));
  }
  if (filters.namespace !== undefined) {
    const nsId = await resolveNamespaceId(db, ownerId, filters.namespace);
    conditions.push(eq(memories.namespaceId, nsId));
  }
  if (filters.importance_min !== undefined) {
    conditions.push(gte(memories.importance, filters.importance_min));
  }
  if (filters.q !== undefined && filters.q.trim() !== "") {
    // Order-independent all-term match: the old single-phrase substring required
    // the words to be adjacent, so `q="Jev Bun"` returned nothing.
    conditions.push(matchesAllTerms(sql`${memories.content}`, filters.q));
  }
  if (filters.tags !== undefined && filters.tags.length) {
    const tagArray = sql`ARRAY[${sql.join(
      filters.tags.map((t) => sql`${t}`),
      sql`, `,
    )}]::text[]`;
    conditions.push(sql`${memories.tags} @> ${tagArray}`);
  }
  const limit = Math.min(filters.limit ?? 20, 10000);
  const offset = Math.max(filters.offset ?? 0, 0);
  return db
    .select({
      ...getTableColumns(memories),
      namespace: namespaces.name,
    })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(and(...conditions))
    .orderBy(desc(memories.importance), desc(memories.updatedAt))
    .limit(limit)
    .offset(offset);
}

/** One standing rule as returned by `getBriefing` — compacted, but still identifiable. */
export interface BriefingItem {
  id: string;
  /** Nullable in the schema; the filter admits any type when the row carries ALWAYS_TAG. */
  type: string | null;
  content: string;
  importance: number | null;
  tags: string[] | null;
  /** Core rules are the guarantee: tagged `always`, or importance >= CORE_IMPORTANCE. */
  core: boolean;
}

/**
 * The session-start briefing: every standing rule in priority order, compacted to fit a
 * character budget.
 *
 * This exists because a standing constraint CANNOT be found by relevance search — relevance
 * is measured against a task that has not been scoped yet. "Warn before large downloads"
 * only helps if it is in context *before* you know it is relevant, so this is the one read
 * that must happen unconditionally at the start of a session rather than on a keyword.
 *
 * Two behaviours are deliberate:
 * - **Core rules are never dropped for budget.** They are the reason the call exists; if the
 *   budget cannot hold them, the result overshoots rather than silently thinning the rules
 *   that matter. Ordering puts core first, so the fill loop cannot cut into them.
 * - **Truncation is reported, never implied.** `truncated` + an exact `omitted` count come
 *   from a COUNT over the same filter, so "what you did not see" is knowable. Silent
 *   truncation is the failure mode this whole path was built to remove.
 */
export interface Briefing {
  count: number;
  core_count: number;
  truncated: boolean;
  omitted: number;
  max_chars: number;
  memories: BriefingItem[];
}

/** Flatten whitespace and cap length — same shape as `snippet()` in search.ts. */
function compactContent(content: string, max = BRIEFING_ITEM_CHARS): string {
  const flat = content.trim().replace(/\s+/g, " ");
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Read the standing rules: `instruction`/`preference` memories, plus any row explicitly
 * tagged `always` regardless of type (the tag is user intent and outranks the type filter).
 */
export async function getBriefing(
  db: Db,
  ownerId: string,
  opts: { namespace?: string; max_chars?: number } = {},
): Promise<Briefing> {
  const maxChars = Math.min(
    Math.max(opts.max_chars ?? BRIEFING_CHARS_DEFAULT, 1000),
    BRIEFING_CHARS_MAX,
  );
  const coreExpr = sql<boolean>`(${memories.tags} @> ARRAY[${ALWAYS_TAG}]::text[] OR ${memories.importance} >= ${CORE_IMPORTANCE})`;
  const conditions = [
    eq(memories.archived, false),
    eq(namespaces.ownerId, ownerId),
    or(
      inArray(memories.type, [...BRIEFING_TYPES]),
      sql`${memories.tags} @> ARRAY[${ALWAYS_TAG}]::text[]`,
    ),
  ];
  if (opts.namespace !== undefined) {
    const nsId = await resolveNamespaceId(db, ownerId, opts.namespace);
    conditions.push(eq(memories.namespaceId, nsId));
  }
  const where = and(...conditions);

  // Exact, not inferred from a capped window: `omitted` has to be trustworthy.
  const totals = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(where);
  const total = totals[0]?.total ?? 0;

  const rows = await db
    .select({
      id: memories.id,
      type: memories.type,
      content: memories.content,
      importance: memories.importance,
      tags: memories.tags,
      core: coreExpr,
    })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(where)
    .orderBy(desc(coreExpr), desc(memories.importance), desc(memories.updatedAt))
    .limit(BRIEFING_FETCH_MAX);

  let used = 0;
  const included: BriefingItem[] = [];
  for (const row of rows) {
    const core = row.core === true;
    const content = compactContent(row.content);
    // Non-core fills what is left, in priority order, stopping at the first rule that does
    // not fit. Core rows are always first (see the ORDER BY), so this never cuts them.
    if (!core && used + content.length > maxChars) break;
    included.push({
      id: row.id,
      type: row.type,
      content,
      importance: row.importance,
      tags: row.tags,
      core,
    });
    used += content.length;
  }

  const omitted = Math.max(total - included.length, 0);
  return {
    count: included.length,
    core_count: included.filter((m) => m.core).length,
    truncated: omitted > 0,
    omitted,
    max_chars: maxChars,
    memories: included,
  };
}

export interface MemoryWhere {
  type?: "fact" | "observation" | "preference" | "instruction";
  namespace?: string;
  tags?: string[];
  importance_min?: number;
  q?: string;
}

/**
 * Batch-update all memories matching `where` (at least one filter required).
 * Returns the number of rows updated. `tags` in the update REPLACES the set.
 */
export async function batchUpdateMemories(
  db: Db,
  ownerId: string,
  where: MemoryWhere,
  update: MemoryUpdate,
  limit = 100,
): Promise<{ count: number }> {
  const conditions = [eq(namespaces.ownerId, ownerId)];
  if (where.type !== undefined) {
    conditions.push(eq(memories.type, where.type));
  }
  if (where.namespace !== undefined) {
    const nsId = await resolveNamespaceId(db, ownerId, where.namespace);
    conditions.push(eq(memories.namespaceId, nsId));
  }
  if (where.tags !== undefined && where.tags.length) {
    const tagArray = sql`ARRAY[${sql.join(
      where.tags.map((t) => sql`${t}`),
      sql`, `,
    )}]::text[]`;
    conditions.push(sql`${memories.tags} @> ${tagArray}`);
  }
  if (where.importance_min !== undefined) {
    conditions.push(gte(memories.importance, where.importance_min));
  }
  if (where.q !== undefined) {
    // Destructive filter: deliberately kept phrase-strict (an all-term match
    // would widen the blast radius of a mass edit), but the wildcards MUST be
    // escaped — an unescaped `q="%"` matched every row in the namespace.
    conditions.push(ilike(memories.content, `%${escapeLike(where.q)}%`));
  }
  if (conditions.length === 1) {
    throw new MemoryError(
      "invalid_input",
      "batch_update requires at least one where filter",
    );
  }

  const sets: Partial<typeof memories.$inferInsert> = {};
  if (update.content !== undefined) sets.content = update.content;
  if (update.type !== undefined) sets.type = update.type;
  if (update.importance !== undefined) sets.importance = update.importance;
  if (update.metadata !== undefined) sets.metadata = update.metadata;
  if (update.archived !== undefined) sets.archived = update.archived;
  if (update.tags !== undefined) sets.tags = normalizeTags(update.tags);
  if (Object.keys(sets).length === 0) {
    throw new MemoryError(
      "invalid_input",
      "batch_update requires at least one update field",
    );
  }

  const ids = await db
    .select({ id: memories.id })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(and(...conditions))
    .limit(Math.min(limit, 500));
  if (ids.length === 0) return { count: 0 };

  const res = await db
    .update(memories)
    .set({ ...sets, updatedAt: sql`now()` })
    .where(
      inArray(
        memories.id,
        ids.map((r) => r.id),
      ),
    )
    .returning({ id: memories.id });
  return { count: res.length };
}
