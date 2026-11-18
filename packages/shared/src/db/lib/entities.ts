import type { Db } from "../client.ts";
import { isUniqueViolation, MemoryError } from "../errors.ts";
import {
  and,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  entities,
  memories,
  memoryEntityLinks,
  namespaces,
  relations,
} from "../schema.ts";
import { normalizeEntityType, normalizeTags } from "../../types.ts";
import { escapeLike, matchesAllTerms, resolveNamespaceId } from "./util.ts";
import { redactForeignAccounts } from "./redact.ts";
import { ENTITY_LIST_COLUMNS } from "./list-columns.ts";

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

/**
 * The entities table has exactly ONE unique key besides the PK, and the PK is a
 * random uuid that never collides: the per-namespace name. So a unique
 * violation on an entity write IS a name conflict.
 */
const ENTITY_NAME_KEY = "entities_namespace_id_name_key";

/**
 * The `already_exists` error for a taken entity name, naming the row that holds
 * it so the caller can go straight to `action=update`. `namespaceId` is
 * optional because the update path may not know it without an extra read; the
 * message degrades to a name-only form when it is absent.
 */
async function entityNameTaken(
  db: Db,
  namespaceId: string | undefined,
  name: string,
  exceptId?: string,
): Promise<MemoryError> {
  let holder: string | undefined;
  if (namespaceId) {
    const conditions: SQL[] = [
      eq(entities.namespaceId, namespaceId),
      eq(entities.name, name),
    ];
    if (exceptId) conditions.push(ne(entities.id, exceptId));
    const rows = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(...conditions))
      .limit(1);
    if (rows[0]) holder = String(rows[0].id);
  }
  const at = holder ? ` (id ${holder})` : "";
  return new MemoryError(
    "already_exists",
    `entity '${name}' already exists${at}; use action=update to change it`,
  );
}

export async function createEntity(
  db: Db,
  ownerId: string,
  namespaceName: string,
  input: EntityCreate,
): Promise<Entity | undefined> {
  const namespaceId = await resolveNamespaceId(db, ownerId, namespaceName);
  const normalized = normalizeTypeAndTags({
    type: input.type,
    tags: input.tags ?? [],
  });
  let rows: Entity[];
  try {
    rows = await db
      .insert(entities)
      .values({
        namespaceId,
        name: input.name,
        type: normalized.type ?? "concept",
        // An entity summary is searchable prose, so it is the same leak channel
        // as memory content — see redact.ts. The NAME is deliberately not
        // redacted: it is an identity, and masking two different addresses to
        // the same string would collide on the unique index.
        summary: (
          await redactForeignAccounts(db, ownerId, [input.summary ?? ""])
        ).texts[0],
        metadata: input.metadata ?? {},
        importance: input.importance ?? 0.5,
        tags: normalized.tags ?? [],
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, ENTITY_NAME_KEY)) {
      throw await entityNameTaken(db, namespaceId, input.name);
    }
    throw error;
  }
  return rows[0];
}

/** Full entity detail: entity + linked memories + in/out relations. */
export async function getEntity(db: Db, ownerId: string, id: string) {
  const entityRows = await db
    .select({
      ...getTableColumns(entities),
      namespace: namespaces.name,
    })
    .from(entities)
    .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId))
    .where(and(eq(entities.id, id), eq(namespaces.ownerId, ownerId)))
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

export async function updateEntity(
  db: Db,
  ownerId: string,
  id: string,
  update: EntityUpdate,
) {
  const sets: Partial<typeof entities.$inferInsert> = {};
  if (update.name !== undefined) sets.name = update.name;
  if (update.type !== undefined) sets.type = update.type;
  if (update.summary !== undefined)
    sets.summary = (
      await redactForeignAccounts(db, ownerId, [update.summary])
    ).texts[0];
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
      .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId))
      .where(and(eq(entities.id, id), eq(namespaces.ownerId, ownerId)))
      .limit(1);
    currentTags = cur[0]?.tags ?? [];
  }
  const normalized = normalizeTypeAndTags(sets, currentTags);

  const owned = db
    .select({ id: namespaces.id })
    .from(namespaces)
    .where(eq(namespaces.ownerId, ownerId));
  let rows: Entity[];
  try {
    rows = await db
      .update(entities)
      .set({ ...sets, ...normalized, updatedAt: sql`now()` })
      .where(and(eq(entities.id, id), inArray(entities.namespaceId, owned)))
      .returning();
  } catch (error) {
    if (
      isUniqueViolation(error, ENTITY_NAME_KEY) &&
      update.name !== undefined
    ) {
      // The rename collided with a DIFFERENT row. Resolve which namespace the
      // row being renamed lives in, so the reported holder is the right one
      // (the same name can exist in another namespace and must not be blamed).
      const target = await db
        .select({ namespaceId: entities.namespaceId })
        .from(entities)
        .where(and(eq(entities.id, id), inArray(entities.namespaceId, owned)))
        .limit(1);
      throw await entityNameTaken(
        db,
        target[0] ? String(target[0].namespaceId) : undefined,
        update.name,
        id,
      );
    }
    throw error;
  }
  const row = rows[0];
  if (!row) throw new MemoryError("not_found", `entity '${id}' not found`);
  return row;
}

export async function deleteEntity(db: Db, ownerId: string, id: string) {
  const owned = db
    .select({ id: namespaces.id })
    .from(namespaces)
    .where(eq(namespaces.ownerId, ownerId));
  const res = await db
    .delete(entities)
    .where(and(eq(entities.id, id), inArray(entities.namespaceId, owned)))
    .returning({ id: entities.id, name: entities.name });
  const row = res[0];
  if (!row) throw new MemoryError("not_found", `entity '${id}' not found`);
  return row;
}

/** Find entities by name (exact or substring) with optional type + namespace filters. */
export interface EntityListFilters {
  namespace?: string;
  q?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

/** A row from the lean entity list — derived from the builder, not the async
 *  wrapper, so the type alias does not circularly reference `findEntityList`. */
export type EntityListRow = Awaited<ReturnType<typeof entityListQuery>>[number];

/**
 * Shared filter assembly. `namespaceMatch` is the caller's predicate: `findEntities`
 * resolves name → id, `findEntityList` inlines a subquery (one round trip).
 */
function entityConditions(
  ownerId: string,
  query: string | undefined,
  type: string | undefined,
  namespaceMatch?: SQL,
): SQL[] {
  const conditions: SQL[] = [eq(namespaces.ownerId, ownerId)];
  if (query !== undefined) {
    // Every term, any order, across name or summary — "Smoke Project" needs no adjacency.
    conditions.push(
      sql`(${matchesAllTerms(sql`${entities.name}`, query)} OR ${matchesAllTerms(sql`${entities.summary}`, query)})`,
    );
  }
  if (type !== undefined) {
    conditions.push(eq(entities.type, type));
  }
  if (namespaceMatch !== undefined) {
    conditions.push(namespaceMatch);
  }
  return conditions;
}

/** Full entity list for MCP/REST/export. importance DESC, updated_at DESC, id DESC — the id tiebreaker keeps `offset` stable. */
export async function findEntities(
  db: Db,
  ownerId: string,
  namespaceName: string | undefined,
  query: string | undefined,
  type: string | undefined,
  limit = 20,
  offset = 0,
) {
  const namespaceMatch =
    namespaceName !== undefined
      ? eq(
          entities.namespaceId,
          await resolveNamespaceId(db, ownerId, namespaceName),
        )
      : undefined;
  return db
    .select({
      ...getTableColumns(entities),
      namespace: namespaces.name,
    })
    .from(entities)
    .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId))
    .where(and(...entityConditions(ownerId, query, type, namespaceMatch)))
    .orderBy(
      desc(entities.importance),
      desc(entities.updatedAt),
      desc(entities.id),
    )
    .limit(Math.min(limit, 10000))
    .offset(Math.max(offset, 0));
}

/**
 * Lean list for the dashboard — same filters, only the columns the card renders. Not async:
 * `db.batch()` needs `_prepare()`, which a Promise lacks.
 */
export function entityListQuery(
  db: Db,
  ownerId: string,
  filters: EntityListFilters = {},
) {
  const namespaceMatch =
    filters.namespace !== undefined
      ? sql`${entities.namespaceId} = (SELECT n2.id FROM ${namespaces} n2 WHERE n2.name = ${filters.namespace} AND n2.owner_id = ${ownerId})`
      : undefined;
  return db
    .select(ENTITY_LIST_COLUMNS)
    .from(entities)
    .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId))
    .where(
      and(
        ...entityConditions(ownerId, filters.q, filters.type, namespaceMatch),
      ),
    )
    .orderBy(
      desc(entities.importance),
      desc(entities.updatedAt),
      desc(entities.id),
    )
    .limit(Math.min(filters.limit ?? 20, 10000))
    .offset(Math.max(filters.offset ?? 0, 0));
}

/** Awaiting wrapper around `entityListQuery` for callers that don't batch. */
export async function findEntityList(
  db: Db,
  ownerId: string,
  filters: EntityListFilters = {},
): Promise<EntityListRow[]> {
  return entityListQuery(db, ownerId, filters);
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
  ownerId: string,
  where: EntityWhere,
  update: EntityUpdate,
  limit = 100,
): Promise<{ count: number }> {
  const conditions = [eq(namespaces.ownerId, ownerId)];
  if (where.type !== undefined) {
    conditions.push(eq(entities.type, where.type));
  }
  if (where.query !== undefined) {
    // Destructive filter: phrase-strict by design, but wildcards escaped — an
    // unescaped `where:{"query":"%"}` matched every entity.
    conditions.push(ilike(entities.name, `%${escapeLike(where.query)}%`));
  }
  if (where.namespace !== undefined) {
    const nsId = await resolveNamespaceId(db, ownerId, where.namespace);
    conditions.push(eq(entities.namespaceId, nsId));
  }
  if (conditions.length === 1) {
    throw new MemoryError(
      "invalid_input",
      "batch_update requires at least one where filter",
    );
  }

  const sets: Partial<typeof entities.$inferInsert> = {};
  if (update.name !== undefined) sets.name = update.name;
  if (update.type !== undefined) sets.type = update.type;
  if (update.summary !== undefined)
    sets.summary = (
      await redactForeignAccounts(db, ownerId, [update.summary])
    ).texts[0];
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
    .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId))
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

  let res: { id: string }[];
  try {
    res = await db
      .update(entities)
      .set({
        ...sets,
        ...normalized,
        ...(tagExpr ? { tags: tagExpr } : {}),
        updatedAt: sql`now()`,
      })
      .where(
        inArray(
          entities.id,
          ids.map((r) => r.id),
        ),
      )
      .returning({ id: entities.id });
  } catch (error) {
    if (
      isUniqueViolation(error, ENTITY_NAME_KEY) &&
      update.name !== undefined
    ) {
      // A batch rename targets many rows at once, so it can span namespaces;
      // a name-only message is the honest one here (no single holder to name).
      throw new MemoryError(
        "already_exists",
        `batch update would rename entities to '${update.name}', but that name is already taken (entity names are unique per namespace); update entities individually`,
      );
    }
    throw error;
  }
  return { count: res.length };
}
