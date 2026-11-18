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
  type SQL,
} from "drizzle-orm";
import {
  entities,
  memories,
  memoryEntityLinks,
  namespaces,
} from "../schema.ts";
import { redactForeignAccounts } from "./redact.ts";
import {
  ALWAYS_TAG,
  BRIEFING_CHARS_DEFAULT,
  BRIEFING_CHARS_MAX,
  BRIEFING_DETAIL_DEFAULT,
  BRIEFING_FETCH_MAX,
  BRIEFING_ITEM_CHARS,
  BRIEFING_TYPES,
  normalizeTags,
  type BriefingDetail,
} from "../../types.ts";
import { escapeLike, matchesAllTerms, resolveNamespaceId } from "./util.ts";
import { MEMORY_DIGEST_COLUMNS, MEMORY_LIST_COLUMNS } from "./list-columns.ts";
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
  /** Move the row here. Entity links do NOT follow — they stay on the old namespace. */
  namespace?: string;
}

/** A full memory row as stored in the DB. */
export type Memory = typeof memories.$inferSelect;

/** Create a memory, optionally linked to 0-3 entities, in one transaction. */
export async function createMemory(
  db: Db,
  ownerId: string,
  input: MemoryCreate,
  source?: string,
  plan?: string | null,
): Promise<
  | (Memory & { namespace: string; redacted_accounts?: number })
  | undefined
> {
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
  // Another ACCOUNT's address must not survive into searchable prose. Scoped to
  // registered accounts, so ordinary contact details are untouched — see redact.ts.
  const { texts: safeContent, redacted } = await redactForeignAccounts(
    db,
    ownerId,
    [input.content],
  );

  // db.batch() = memory + link inserts in ONE Neon HTTP call (atomic).
  const queries: BatchItem<"pg">[] = [
    db.insert(memories).values({
      id,
      namespaceId,
      content: safeContent[0]!,
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
  const row = rows[0];
  if (!row) return undefined;
  // Report the mask rather than applying it silently: the caller wrote something
  // and is entitled to know it did not survive verbatim.
  return redacted ? { ...row, redacted_accounts: redacted } : row;
}

/** Builder: the memory row plus its namespace, scoped to the owner. */
export function memoryDetailQuery(db: Db, ownerId: string, id: string) {
  return db
    .select({
      ...getTableColumns(memories),
      namespace: namespaces.name,
    })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(and(eq(memories.id, id), eq(namespaces.ownerId, ownerId)))
    .limit(1);
}

/** Builder: the entities this memory is linked to, by name. */
export function memoryLinksQuery(db: Db, id: string) {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
    })
    .from(memoryEntityLinks)
    .innerJoin(entities, eq(entities.id, memoryEntityLinks.entityId))
    .where(eq(memoryEntityLinks.memoryId, id))
    .orderBy(entities.name);
}

/** Memory detail + linked entity names, both reads in one `db.batch`. */
export async function getMemory(db: Db, ownerId: string, id: string) {
  const [rows, links] = await db.batch([
    memoryDetailQuery(db, ownerId, id),
    memoryLinksQuery(db, id),
  ]);
  const memory = rows[0];
  if (!memory) throw new MemoryError("not_found", `memory '${id}' not found`);
  return { ...memory, entities: links };
}

export async function updateMemory(
  db: Db,
  ownerId: string,
  id: string,
  update: MemoryUpdate,
) {
  const sets: Partial<typeof memories.$inferInsert> = {};
  if (update.content !== undefined)
    // Same guard as create: an update can just as easily walk another
    // account's address into the store.
    sets.content = (
      await redactForeignAccounts(db, ownerId, [update.content])
    ).texts[0];
  if (update.type !== undefined) sets.type = update.type;
  if (update.importance !== undefined) sets.importance = update.importance;
  if (update.metadata !== undefined) sets.metadata = update.metadata;
  if (update.archived !== undefined) sets.archived = update.archived;
  if (update.tags !== undefined) sets.tags = normalizeTags(update.tags);
  // A move resolves through the owned-namespace guard in `resolveNamespaceId`,
  // so a typo throws `namespace_not_found` instead of silently orphaning the row.
  // `updateMemory` and `batchUpdateMemories` both land here.
  if (update.namespace !== undefined)
    sets.namespaceId = await resolveNamespaceId(db, ownerId, update.namespace);

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

/**
 * Shared filter assembly. `namespaceMatch` is the caller's predicate:
 * `queryMemories` resolves name → id, `queryMemoryList` inlines a subquery.
 */
function memoryConditions(
  ownerId: string,
  filters: MemoryQueryFilters,
  namespaceMatch?: SQL,
): SQL[] {
  const conditions: SQL[] = [
    eq(memories.archived, filters.archived ?? false),
    eq(namespaces.ownerId, ownerId),
  ];
  if (filters.type !== undefined) {
    conditions.push(eq(memories.type, filters.type));
  }
  if (namespaceMatch !== undefined) {
    conditions.push(namespaceMatch);
  }
  if (filters.importance_min !== undefined) {
    conditions.push(gte(memories.importance, filters.importance_min));
  }
  if (filters.q !== undefined && filters.q.trim() !== "") {
    // All-term match, any order: the old phrase-only form missed `q="Jev Bun"`.
    conditions.push(matchesAllTerms(sql`${memories.content}`, filters.q));
  }
  if (filters.tags !== undefined && filters.tags.length) {
    const tagArray = sql`ARRAY[${sql.join(
      filters.tags.map((t) => sql`${t}`),
      sql`, `,
    )}]::text[]`;
    conditions.push(sql`${memories.tags} @> ${tagArray}`);
  }
  return conditions;
}

/** importance DESC, updated_at DESC, id DESC — the id tiebreaker keeps `offset` stable. */
export async function queryMemories(
  db: Db,
  ownerId: string,
  filters: MemoryQueryFilters = {},
) {
  const namespaceMatch =
    filters.namespace !== undefined
      ? eq(
          memories.namespaceId,
          await resolveNamespaceId(db, ownerId, filters.namespace),
        )
      : undefined;
  const limit = Math.min(filters.limit ?? 20, 10000);
  const offset = Math.max(filters.offset ?? 0, 0);
  return db
    .select({
      ...getTableColumns(memories),
      namespace: namespaces.name,
    })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(and(...memoryConditions(ownerId, filters, namespaceMatch)))
    .orderBy(
      desc(memories.importance),
      desc(memories.updatedAt),
      desc(memories.id),
    )
    .limit(limit)
    .offset(offset);
}

/** A row from the lean list. Derived from the builder to avoid a circular alias. */
export type MemoryListRow = Awaited<ReturnType<typeof memoryListQuery>>[number];

/**
 * Lean list for the dashboard — same filters, only the columns the card renders.
 * Not async: `db.batch()` needs `_prepare()`, which a Promise lacks.
 */
export function memoryListQuery(
  db: Db,
  ownerId: string,
  filters: MemoryQueryFilters = {},
) {
  const namespaceMatch = memoryNamespaceMatch(ownerId, filters);
  return db
    .select({ ...MEMORY_LIST_COLUMNS, namespace: namespaces.name })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(and(...memoryConditions(ownerId, filters, namespaceMatch)))
    .orderBy(
      desc(memories.importance),
      desc(memories.updatedAt),
      desc(memories.id),
    )
    .limit(Math.min(filters.limit ?? 20, 10000))
    .offset(Math.max(filters.offset ?? 0, 0));
}

/**
 * The list read plus `metadata`/`source` (the digest view needs the title and
 * status). Written out because threading a generic column map flattens Drizzle's
 * row type to `unknown`.
 */
export function memoryDigestQuery(
  db: Db,
  ownerId: string,
  filters: MemoryQueryFilters = {},
) {
  const namespaceMatch = memoryNamespaceMatch(ownerId, filters);
  return db
    .select({ ...MEMORY_DIGEST_COLUMNS, namespace: namespaces.name })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(and(...memoryConditions(ownerId, filters, namespaceMatch)))
    .orderBy(
      desc(memories.importance),
      desc(memories.updatedAt),
      desc(memories.id),
    )
    .limit(Math.min(filters.limit ?? 20, 10000))
    .offset(Math.max(filters.offset ?? 0, 0));
}

/**
 * Dashboard namespace predicate: a SUBQUERY on the name, because a filter value from
 * the dropdown going stale should yield an empty list, not a round trip and a throw.
 */
function memoryNamespaceMatch(
  ownerId: string,
  filters: MemoryQueryFilters,
): SQL | undefined {
  return filters.namespace !== undefined
    ? sql`${memories.namespaceId} = (SELECT n2.id FROM ${namespaces} n2 WHERE n2.name = ${filters.namespace} AND n2.owner_id = ${ownerId})`
    : undefined;
}

/** Awaiting wrapper around `memoryListQuery` for callers that don't batch. */
export async function queryMemoryList(
  db: Db,
  ownerId: string,
  filters: MemoryQueryFilters = {},
): Promise<MemoryListRow[]> {
  return memoryListQuery(db, ownerId, filters);
}

/** One standing rule as returned by `getBriefing` — compacted, but still identifiable. */
export interface BriefingItem {
  id: string;
  /** Nullable in the schema; the filter admits any type when the row carries ALWAYS_TAG. */
  type: string | null;
  content: string;
  importance: number | null;
  tags: string[] | null;
  /** Core = the `always` tag, and only the tag — membership is explicit, importance only ranks. */
  core: boolean;
}

/**
 * The session-start briefing. A standing rule cannot be found by relevance search,
 * so this is the one read that is unconditional. Core is the guarantee and never
 * dropped for budget; the tail is opt-in and grows without bound.
 */
export interface Briefing {
  /** Which slice was requested — `core` unless the caller escalated. */
  detail: BriefingDetail;
  /** Standing rules returned. */
  count: number;
  /** Of those, how many are core. */
  core_count: number;
  /**
   * Standing rules that exist beyond core, across every namespace. The tail is
   * where situational rules live; it is NOT returned by default, and this number
   * is how a caller knows it is there without loading it.
   */
  other_standing: number;
  /**
   * Set when the briefing was scoped to one namespace and part of the tail lives
   * in the others. `other_standing` is the total; this is the slice a different
   * `namespace` would show.
   */
  other_scopes?: { tail: number };
  /** `true` when even the requested slice was incomplete (all-mode budget, or a huge core). */
  truncated: boolean;
  /** How many of the requested slice were left out. Exact (COUNT), never inferred. */
  omitted: number;
  /** The budget in effect — only present for `detail: "all"` when the budget applies. */
  max_chars?: number;
  memories: BriefingItem[];
}

/** Flatten whitespace and cap length — same shape as `snippet()` in search.ts. */
function compactContent(content: string, max = BRIEFING_ITEM_CHARS): string {
  const flat = content.trim().replace(/\s+/g, " ");
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Options `getBriefing` and its dashboard twin both accept. */
interface BriefingOptions {
  namespace?: string;
  max_chars?: number;
  detail?: BriefingDetail;
  /**
   * Set false to get the whole requested slice with no character budget
   * (the dashboard's browsing view). Default true — the AI's escalation to
   * `detail: "all"` must stay bounded no matter how large the tail grows.
   */
  budget?: boolean;
}

/** The resolved knobs the briefing reads and its mapper both need. */
function briefingPlan(opts: BriefingOptions) {
  return {
    detail: (opts.detail ?? BRIEFING_DETAIL_DEFAULT) as BriefingDetail,
    applyBudget: opts.budget ?? true,
    maxChars: Math.min(
      Math.max(opts.max_chars ?? BRIEFING_CHARS_DEFAULT, 1000),
      BRIEFING_CHARS_MAX,
    ),
  };
}

/**
 * The briefing's WHERE. Core is the `always` tag alone; `namespaceMatch` scopes the
 * TAIL only — scoping core would make a universal rule vanish outside its own project.
 */
function briefingFilter(ownerId: string, namespaceMatch?: SQL) {
  const alwaysExpr = sql`${memories.tags} @> ARRAY[${ALWAYS_TAG}]::text[]`;
  // Left unannotated on purpose: `or(...)` is `SQL | undefined` in this Drizzle
  // version, and the original code let the literal infer that union.
  const conditions = [
    eq(memories.archived, false),
    eq(namespaces.ownerId, ownerId),
    or(inArray(memories.type, [...BRIEFING_TYPES]), alwaysExpr),
  ];
  // Substituting a literal rather than leaving these undefined is what keeps the
  // three counts disjoint: unscoped means "all tail is in scope", and nothing is
  // elsewhere. A NULL operand would make both tail buckets count zero.
  const nsExpr = namespaceMatch ?? sql`TRUE`;
  const notNsExpr = namespaceMatch ? sql`NOT (${namespaceMatch})` : sql`FALSE`;
  return { alwaysExpr, notAlwaysExpr: sql`NOT (${alwaysExpr})`, conditions, nsExpr, notNsExpr };
}

/**
 * The briefing's two reads as a READONLY TUPLE — totals first, rows second — so
 * the two can go in one `db.batch` and a caller can append its own statements.
 */
function briefingStatementPair(
  db: Db,
  ownerId: string,
  detail: BriefingDetail,
  namespaceMatch?: SQL,
) {
  const { alwaysExpr, notAlwaysExpr, conditions, nsExpr, notNsExpr } =
    briefingFilter(ownerId, namespaceMatch);
  const where = and(...conditions);
  // Core is filtered WITHOUT the namespace predicate, so the count and the rows
  // agree with each other and with `getBriefing`'s contract.
  const coreWhere = and(...conditions, alwaysExpr);
  // `all` returns core from everywhere plus the tail from this namespace only.
  const allWhere = and(...conditions, or(alwaysExpr, nsExpr));
  return [
    // Both counts in ONE statement, and exact rather than inferred from a capped
    // window: `omitted` has to be trustworthy, and `other_standing` is what makes
    // the tail discoverable.
    db
      .select({
        core: sql<number>`(COUNT(*) FILTER (WHERE ${alwaysExpr}))::int`,
        tail_scoped:
          sql<number>`(COUNT(*) FILTER (WHERE ${notAlwaysExpr} AND ${nsExpr}))::int`,
        tail_elsewhere:
          sql<number>`(COUNT(*) FILTER (WHERE ${notAlwaysExpr} AND ${notNsExpr}))::int`,
      })
      .from(memories)
      .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
      .where(where),
    db
      .select({
        id: memories.id,
        type: memories.type,
        content: memories.content,
        importance: memories.importance,
        tags: memories.tags,
        core: alwaysExpr,
      })
      .from(memories)
      .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
      .where(detail === "core" ? coreWhere : allWhere)
      .orderBy(
        desc(alwaysExpr),
        desc(memories.importance),
        desc(memories.updatedAt),
      )
      .limit(BRIEFING_FETCH_MAX),
  ] as const;
}

type BriefingStatementPair = ReturnType<typeof briefingStatementPair>;
/** Await each element: `Awaited<tuple>` leaves the elements' promises alone. */
type BriefingTotals = Awaited<BriefingStatementPair[0]>;
type BriefingRows = Awaited<BriefingStatementPair[1]>;

/**
 * The DASHBOARD's briefing. Diverges from `getBriefing` on purpose: a stale namespace
 * name yields an empty briefing (subquery) rather than throwing, so it batches with
 * `namespacesQuery` in one trip. The MCP path keeps the throw.
 */
export function briefingQueries(
  db: Db,
  ownerId: string,
  opts: BriefingOptions = {},
) {
  return briefingStatementPair(
    db,
    ownerId,
    briefingPlan(opts).detail,
    opts.namespace !== undefined
      ? sql`${memories.namespaceId} = (SELECT n2.id FROM ${namespaces} n2 WHERE n2.name = ${opts.namespace} AND n2.owner_id = ${ownerId})`
      : undefined,
  );
}

/** The compaction + budget accounting — shared by both entry points. */
export function buildBriefing(
  totals: BriefingTotals,
  rows: BriefingRows,
  opts: BriefingOptions = {},
): Briefing {
  const { detail, applyBudget, maxChars } = briefingPlan(opts);
  const totalCore = totals[0]?.core ?? 0;
  const tailScoped = totals[0]?.tail_scoped ?? 0;
  const tailElsewhere = totals[0]?.tail_elsewhere ?? 0;
  // What this read could return: core from everywhere + the tail in scope.
  const total = totalCore + tailScoped;

  let used = 0;
  const included: BriefingItem[] = [];
  for (const row of rows) {
    const core = row.core === true;
    const content = compactContent(row.content);
    // Only `all` mode fills a budget, and it stops at the first rule that does not fit.
    // Core rows are ordered first, so this can never cut into them. `budget: false`
    // skips the budget entirely — the caller then gets an exact, untruncated slice.
    if (
      applyBudget &&
      detail === "all" &&
      !core &&
      used + content.length > maxChars
    )
      break;
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

  // Measured against the REQUESTED slice, so `truncated` means "this answer is short of what
  // you asked for" rather than a permanent nag about the tail the caller chose not to load.
  const requested = detail === "core" ? totalCore : total;
  const omitted = Math.max(requested - included.length, 0);
  return {
    detail,
    count: included.length,
    core_count: included.filter((m) => m.core).length,
    // Every tail rule that exists, in this scope or not — the number that makes
    // the unreturned tail discoverable. Unchanged meaning from before scoping.
    other_standing: tailScoped + tailElsewhere,
    truncated: omitted > 0,
    omitted,
    ...(detail === "all" && applyBudget ? { max_chars: maxChars } : {}),
    ...(tailElsewhere > 0 ? { other_scopes: { tail: tailElsewhere } } : {}),
    memories: included,
  };
}

export async function getBriefing(
  db: Db,
  ownerId: string,
  opts: BriefingOptions = {},
): Promise<Briefing> {
  const { detail } = briefingPlan(opts);
  // MCP CONTRACT: an unknown namespace THROWS, so the name is resolved to an id
  // here instead of being matched by subquery. That costs a round trip only when
  // a namespace filter was actually asked for; the two reads below are one batch
  // (they used to be two sequential round trips).
  const namespaceMatch =
    opts.namespace !== undefined
      ? eq(
          memories.namespaceId,
          await resolveNamespaceId(db, ownerId, opts.namespace),
        )
      : undefined;
  const [totals, rows] = await db.batch(
    briefingStatementPair(db, ownerId, detail, namespaceMatch),
  );
  return buildBriefing(totals, rows, opts);
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
  if (update.content !== undefined)
    sets.content = (
      await redactForeignAccounts(db, ownerId, [update.content])
    ).texts[0];
  if (update.type !== undefined) sets.type = update.type;
  if (update.importance !== undefined) sets.importance = update.importance;
  if (update.metadata !== undefined) sets.metadata = update.metadata;
  if (update.archived !== undefined) sets.archived = update.archived;
  if (update.tags !== undefined) sets.tags = normalizeTags(update.tags);
  if (update.namespace !== undefined)
    sets.namespaceId = await resolveNamespaceId(db, ownerId, update.namespace);
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
