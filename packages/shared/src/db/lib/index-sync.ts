/**
 * Write-through index sync — the ONLY place mutations write to OpenSearch.
 *
 * Contract:
 *   1. NO-OP entirely when OPENSEARCH_URL is unset — zero cost unconfigured.
 *   2. NEVER throw — a dead cluster logs a warning and the mutation stands.
 *      Postgres is the source of truth; search() falls back to coverage when
 *      the cluster returns nothing, so a failed sync costs ranking quality
 *      for a while, never correctness.
 *   3. AWAITS before the caller returns — a search issued right after a write
 *      sees the write (no fire-and-forget races).
 *
 * Rows are re-read through the Drizzle builder (same camelCase shape the rest
 * of the codebase uses) so doc building never depends on raw-SQL aliasing.
 */
import type { Db } from "../client.ts";
import { entities, memories, namespaces } from "../schema.ts";
import { eq, getTableColumns, inArray } from "drizzle-orm";
import {
  bulkIndex,
  deleteByQuery,
  deleteDoc,
  indexDoc,
  opensearchEnabled,
  type OsIndexDoc,
} from "./opensearch-client.ts";

/**
 * A row joined with its namespace: everything a doc needs. Field nullability
 * mirrors Drizzle's inferred select type (schema columns are not all notNull).
 */
export interface SyncMemoryRow {
  id: string;
  namespaceId: string;
  content: string | null;
  type: string | null;
  importance: number | null;
  tags: string[] | null;
  archived: boolean | null;
  metadata: unknown;
  updatedAt: string | Date | null;
  namespace: string;
  ownerId: string | null;
}

export interface SyncEntityRow {
  id: string;
  namespaceId: string;
  name: string | null;
  type: string | null;
  summary: string | null;
  importance: number | null;
  tags: string[] | null;
  updatedAt: string | Date | null;
  namespace: string;
  ownerId: string | null;
}

/**
 * Memory row → index doc. The haystack mirrors exactly what coverage search
 * matches: content + digest title + conversation_id + source_ai. The
 * `transcript` (≤100k fidelity-only blob) is deliberately excluded — indexing
 * it would make nearly every query match every digest.
 * Returns null for a missing row (caller deletes the doc instead).
 */
export function buildMemoryDoc(row: SyncMemoryRow | null): OsIndexDoc | null {
  if (!row || row.id === undefined || row.id === null) return null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const haystack = [
    String(row.content ?? ""),
    String(meta.title ?? ""),
    String(meta.conversation_id ?? ""),
    String(meta.source_ai ?? ""),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    kind: "memory",
    id: String(row.id),
    owner_id: String(row.ownerId ?? ""),
    namespace_id: String(row.namespaceId),
    namespace: String(row.namespace),
    type: String(row.type ?? "fact"),
    tags: (row.tags ?? []) as string[],
    archived: Boolean(row.archived),
    importance: Number(row.importance ?? 0),
    updated_at: new Date(row.updatedAt ?? Date.now()).toISOString(),
    haystack,
    content: String(row.content ?? ""),
  };
}

/** Entity row → index doc; haystack = name + summary (coverage's entHaystack). */
export function buildEntityDoc(row: SyncEntityRow | null): OsIndexDoc | null {
  if (!row || row.id === undefined || row.id === null) return null;
  const name = String(row.name ?? "");
  const summary = String(row.summary ?? "");
  return {
    kind: "entity",
    id: String(row.id),
    owner_id: String(row.ownerId ?? ""),
    namespace_id: String(row.namespaceId),
    namespace: String(row.namespace),
    type: String(row.type ?? "concept"),
    tags: (row.tags ?? []) as string[],
    importance: Number(row.importance ?? 0),
    updated_at: new Date(row.updatedAt ?? Date.now()).toISOString(),
    haystack: `${name} ${summary}`.replace(/\s+/g, " ").trim(),
    name,
    summary,
  };
}

function warn(kind: string, id: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[opensearch] sync ${kind}:${id} failed — ${msg}`);
}

/**
 * Row + namespace join for memories — exported so the backfill script indexes
 * rows with the EXACT same shape the write-through hooks use.
 */
export function memoryRowQuery(db: Db) {
  return db
    .select({
      ...getTableColumns(memories),
      namespace: namespaces.name,
      ownerId: namespaces.ownerId,
    })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId));
}

export function entityRowQuery(db: Db) {
  return db
    .select({
      ...getTableColumns(entities),
      namespace: namespaces.name,
      ownerId: namespaces.ownerId,
    })
    .from(entities)
    .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId));
}

/** Upsert one memory doc (create/update hooks). */
export async function syncMemory(db: Db, id: string): Promise<void> {
  if (!opensearchEnabled()) return;
  try {
    const rows = await memoryRowQuery(db).where(eq(memories.id, id));
    const doc = buildMemoryDoc((rows[0] as SyncMemoryRow | undefined) ?? null);
    if (doc) await indexDoc(doc);
    else await deleteDoc(`memory:${id}`);
  } catch (err) {
    warn("memory", id, err);
  }
}

/** Upsert one entity doc (create/update hooks). */
export async function syncEntity(db: Db, id: string): Promise<void> {
  if (!opensearchEnabled()) return;
  try {
    const rows = await entityRowQuery(db).where(eq(entities.id, id));
    const doc = buildEntityDoc((rows[0] as SyncEntityRow | undefined) ?? null);
    if (doc) await indexDoc(doc);
    else await deleteDoc(`entity:${id}`);
  } catch (err) {
    warn("entity", id, err);
  }
}

/** Bulk upsert memory docs (batch_update / prune-archive / ingest hooks). */
export async function syncMemoryIds(db: Db, ids: string[]): Promise<void> {
  if (!opensearchEnabled() || !ids.length) return;
  try {
    const rows = await memoryRowQuery(db).where(inArray(memories.id, ids));
    const docs = rows
      .map((r) => buildMemoryDoc(r as SyncMemoryRow))
      .filter((d): d is OsIndexDoc => d !== null);
    await bulkIndex(docs);
  } catch (err) {
    warn("memory", `bulk(${ids.length})`, err);
  }
}

/** Bulk upsert entity docs (batch_update / ingest hooks). */
export async function syncEntityIds(db: Db, ids: string[]): Promise<void> {
  if (!opensearchEnabled() || !ids.length) return;
  try {
    const rows = await entityRowQuery(db).where(inArray(entities.id, ids));
    const docs = rows
      .map((r) => buildEntityDoc(r as SyncEntityRow))
      .filter((d): d is OsIndexDoc => d !== null);
    await bulkIndex(docs);
  } catch (err) {
    warn("entity", `bulk(${ids.length})`, err);
  }
}

/** Remove one memory doc (delete / purge hooks). 404 tolerated in client. */
export async function unsyncMemory(_db: Db, id: string): Promise<void> {
  if (!opensearchEnabled()) return;
  try {
    await deleteDoc(`memory:${id}`);
  } catch (err) {
    warn("memory", id, err);
  }
}

export async function unsyncEntity(_db: Db, id: string): Promise<void> {
  if (!opensearchEnabled()) return;
  try {
    await deleteDoc(`entity:${id}`);
  } catch (err) {
    warn("entity", id, err);
  }
}

/**
 * Namespace delete → purge every doc under it. The FK cascade removes the
 * rows in Postgres; without this the index would keep serving ghost hits
 * scoped to a namespace id that no longer resolves.
 */
export async function unsyncByNamespace(namespaceId: string): Promise<void> {
  if (!opensearchEnabled()) return;
  try {
    await deleteByQuery([{ term: { namespace_id: namespaceId } }]);
  } catch (err) {
    warn("namespace", namespaceId, err);
  }
}
