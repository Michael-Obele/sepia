import type { Db } from "../client.ts";
import { MemoryError } from "../errors.ts";
import {
  and,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  sql,
} from "drizzle-orm";
import {
  entities,
  memories,
  memoryEntityLinks,
  namespaces,
  relations,
} from "../schema.ts";
import { normalizeEntityType, normalizeTags } from "../../types.ts";
import { resolveNamespaceId } from "./util.ts";

export interface EntityCreate {
  name: string;
  type: string;
  summary?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface EntityUpdate {
  name?: string;
  type?: string;
  summary?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  /** REPLACES the tag set. */
  tags?: string[];
}

/** A full entity row as stored in the DB. */
export type Entity = typeof entities.$inferSelect;

/**
 * Apply canonical-type + tag normalization to a partial entity insert/update.
 * Unknown types become `concept` with the original value preserved as a tag.
 * `currentTags` (existing row tags) is used to merge the fallback tag without
 * data loss when tags aren't explicitly provided.
 */
function normalizeTypeAndTags(
  sets: { type?: string; tags?: string[] | null },
  currentTags?: string[],
): { type?: string; tags?: string[] } {
  const out: { type?: string; tags?: string[] } = {};
  if (sets.type !== undefined) {
    const { type, tag } = normalizeEntityType(sets.type);
    out.type = type;
    if (tag) {
      const base = sets.tags ?? currentTags ?? [];
      out.tags = base.includes(tag) ? base : [...base, tag];
    }
  }
  if (sets.tags !== undefined) {
    out.tags = normalizeTags(out.tags ?? sets.tags ?? []);
  }
  return out;
}

export async function createEntity(
  db: Db,
  namespaceName: string,
  input: EntityCreate,
): Promise<Entity | undefined> {
  const namespaceId = await resolveNamespaceId(db, namespaceName);
  const normalized = normalizeTypeAndTags({
    type: input.type,
    tags: input.tags ?? [],
  });
  const rows = await db
    .insert(entities)
    .values({
      namespaceId,
      name: input.name,
      type: normalized.type ?? "concept",
      summary: input.summary ?? "",
      metadata: input.metadata ?? {},
      importance: input.importance ?? 0.5,
      tags: normalized.tags ?? [],
    })
    .returning();
  return rows[0];
}

/** Full entity detail: entity + linked memories + in/out relations. */
export async function getEntity(db: Db, id: string) {
  const entityRows = await db
    .select({
      ...getTableColumns(entities),
      namespace: namespaces.name,
    })
    .from(entities)
    .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId))
    .where(eq(entities.id, id))
    .limit(1);
  const entity = entityRows[0];
  if (!entity) throw new MemoryError("not_found", `entity '${id}' not found`);

  // Bump access count — feeds dashboard "top entities" stats.
  await db
    .update(entities)
    .set({ accessCount: sql`${entities.accessCount} + 1` })
    .where(eq(entities.id, id));

  const [memoriesRows, relationsOut, relationsIn] = await Promise.all([
    db
      .select({ ...getTableColumns(memories) })
      .from(memories)
      .innerJoin(memoryEntityLinks, eq(memoryEntityLinks.memoryId, memories.id))
      .where(
        and(eq(memoryEntityLinks.entityId, id), eq(memories.archived, false)),
      )
      .orderBy(desc(memories.importance), desc(memories.updatedAt)),
    db
      .select({
        id: relations.id,
        other_id: relations.targetId,
        relation_type: relations.relationType,
        weight: relations.weight,
        other_name: entities.name,
        other_type: entities.type,
      })
      .from(relations)
      .innerJoin(entities, eq(entities.id, relations.targetId))
      .where(eq(relations.sourceId, id))
      .orderBy(desc(relations.weight)),
    db
      .select({
        id: relations.id,
        other_id: relations.sourceId,
        relation_type: relations.relationType,
        weight: relations.weight,
        other_name: entities.name,
        other_type: entities.type,
      })
      .from(relations)
      .innerJoin(entities, eq(entities.id, relations.sourceId))
      .where(eq(relations.targetId, id))
      .orderBy(desc(relations.weight)),
  ]);

  return {
    ...entity,
    memories: memoriesRows,
    relations_out: relationsOut,
    relations_in: relationsIn,
  };
}

export async function updateEntity(db: Db, id: string, update: EntityUpdate) {
  const sets: Partial<typeof entities.$inferInsert> = {};
  if (update.name !== undefined) sets.name = update.name;
  if (update.type !== undefined) sets.type = update.type;
  if (update.summary !== undefined) sets.summary = update.summary;
  if (update.importance !== undefined) sets.importance = update.importance;
  if (update.metadata !== undefined) sets.metadata = update.metadata;
  if (update.tags !== undefined) sets.tags = update.tags;
  if (Object.keys(sets).length === 0) {
    throw new MemoryError("invalid_input", "no fields to update");
  }
  // When the type normalizes to a fallback tag and tags aren't provided,
  // merge into the existing tags (no data loss).
  let currentTags: string[] | undefined;
  if (update.type !== undefined && update.tags === undefined) {
    const cur = await db
      .select({ tags: entities.tags })
      .from(entities)
      .where(eq(entities.id, id))
      .limit(1);
    currentTags = cur[0]?.tags ?? [];
  }
  const normalized = normalizeTypeAndTags(sets, currentTags);

  const rows = await db
    .update(entities)
    .set({ ...sets, ...normalized, updatedAt: sql`now()` })
    .where(eq(entities.id, id))
    .returning();
  const row = rows[0];
  if (!row) throw new MemoryError("not_found", `entity '${id}' not found`);
  return row;
}

export async function deleteEntity(db: Db, id: string) {
  const res = await db
    .delete(entities)
    .where(eq(entities.id, id))
    .returning({ id: entities.id, name: entities.name });
  const row = res[0];
  if (!row) throw new MemoryError("not_found", `entity '${id}' not found`);
  return row;
}

/** Find entities by name (exact or substring) with optional type + namespace filters. */
export async function findEntities(
  db: Db,
  namespaceName: string | undefined,
  query: string | undefined,
  type: string | undefined,
  limit = 10,
  offset = 0,
) {
  const conditions = [];
  if (query !== undefined) {
    conditions.push(ilike(entities.name, `%${query}%`));
  }
  if (type !== undefined) {
    conditions.push(eq(entities.type, type));
  }
  if (namespaceName !== undefined) {
    const nsId = await resolveNamespaceId(db, namespaceName);
    conditions.push(eq(entities.namespaceId, nsId));
  }
  return db
    .select({
      ...getTableColumns(entities),
      namespace: namespaces.name,
    })
    .from(entities)
    .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(entities.importance), desc(entities.updatedAt))
    .limit(Math.min(limit, 10000))
    .offset(Math.max(offset, 0));
}

export interface EntityWhere {
  type?: string;
  namespace?: string;
  query?: string;
}

/**
 * Batch-update all entities matching `where` (at least one filter required).
 * Returns the number of rows updated. `tags` in the update REPLACES the set.
 */
export async function batchUpdateEntities(
  db: Db,
  where: EntityWhere,
  update: EntityUpdate,
  limit = 100,
): Promise<{ count: number }> {
  const conditions = [];
  if (where.type !== undefined) {
    conditions.push(eq(entities.type, where.type));
  }
  if (where.query !== undefined) {
    conditions.push(ilike(entities.name, `%${where.query}%`));
  }
  if (where.namespace !== undefined) {
    const nsId = await resolveNamespaceId(db, where.namespace);
    conditions.push(eq(entities.namespaceId, nsId));
  }
  if (conditions.length === 0) {
    throw new MemoryError(
      "invalid_input",
      "batch_update requires at least one where filter",
    );
  }

  const sets: Partial<typeof entities.$inferInsert> = {};
  if (update.name !== undefined) sets.name = update.name;
  if (update.type !== undefined) sets.type = update.type;
  if (update.summary !== undefined) sets.summary = update.summary;
  if (update.importance !== undefined) sets.importance = update.importance;
  if (update.metadata !== undefined) sets.metadata = update.metadata;
  if (update.tags !== undefined) sets.tags = update.tags;
  if (Object.keys(sets).length === 0) {
    throw new MemoryError(
      "invalid_input",
      "batch_update requires at least one update field",
    );
  }
  const normalized = normalizeTypeAndTags(sets);

  const ids = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(...conditions))
    .limit(Math.min(limit, 500));
  if (ids.length === 0) return { count: 0 };

  // If type normalization produced a fallback tag and tags weren't provided,
  // merge it into existing tags via SQL (no data loss across the batch).
  const fallbackTag =
    normalized.tags !== undefined && update.tags === undefined
      ? normalized.tags[0]
      : undefined;
  const tagExpr = fallbackTag
    ? sql`array(SELECT DISTINCT unnest(${entities.tags} || ARRAY[${fallbackTag}]::text[]))`
    : undefined;

  const res = await db
    .update(entities)
    .set({
      ...sets,
      ...normalized,
      ...(tagExpr ? { tags: tagExpr } : {}),
      updatedAt: sql`now()`,
    })
    .where(inArray(entities.id, ids.map((r) => r.id)))
    .returning({ id: entities.id });
  return { count: res.length };
}
