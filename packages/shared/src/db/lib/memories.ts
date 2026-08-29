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
  sql,
} from "drizzle-orm";
import {
  entities,
  memories,
  memoryEntityLinks,
  namespaces,
} from "../schema.ts";
import { normalizeTags } from "../../types.ts";
import { resolveNamespaceId } from "./util.ts";
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
    conditions.push(ilike(memories.content, `%${filters.q.trim()}%`));
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
    conditions.push(ilike(memories.content, `%${where.q}%`));
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
