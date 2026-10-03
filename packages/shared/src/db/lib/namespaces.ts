import type { Db } from "../client.ts";
import { MemoryError } from "../errors.ts";
import { and, eq, sql } from "drizzle-orm";
import { namespaces } from "../schema.ts";
import { DEFAULT_NAMESPACE } from "../../types.ts";
import { getNamespaceByIdOrName } from "./util.ts";
import { assertNamespaceQuota } from "./plans.ts";
import { unsyncByNamespace } from "./index-sync.ts";

export interface NamespaceStats {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  entity_count: number;
  memory_count: number;
  relation_count: number;
}

export async function createNamespace(
  db: Db,
  ownerId: string,
  name: string,
  description = "",
  plan?: string | null,
) {
  await assertNamespaceQuota(db, ownerId, plan);
  const rows = await db
    .insert(namespaces)
    .values({ ownerId, name, description })
    .onConflictDoNothing()
    .returning();
  const row = rows[0];
  if (!row) {
    throw new MemoryError(
      "already_exists",
      `namespace '${name}' already exists (use manage_namespace action=list to see namespaces)`,
    );
  }
  return row;
}

/**
 * Builder form of the namespace list — NOT async, so it can be composed into
 * `db.batch([...])`. `db.batch` calls `_prepare()` on each element, which an
 * async function cannot provide (it returns a native Promise).
 */
export function namespacesQuery(db: Db, ownerId: string) {
  // Correlated count subqueries. Use db.execute with explicit `n.id` — a
  // query-builder ${namespaces.id} renders unqualified and resolves wrong.
  return db.execute(sql`
    SELECT n.id, n.name, n.description, n.created_at, n.updated_at,
      (SELECT count(*)::int FROM entities e WHERE e.namespace_id = n.id) AS entity_count,
      (SELECT count(*)::int FROM memories m WHERE m.namespace_id = n.id) AS memory_count,
      (SELECT count(*)::int FROM relations r WHERE r.namespace_id = n.id) AS relation_count
    FROM ${namespaces} n
    WHERE n.owner_id = ${ownerId}
    ORDER BY n.name
  `);
}

/** Awaiting wrapper around `namespacesQuery` for callers that don't batch. */
export async function listNamespaces(
  db: Db,
  ownerId: string,
): Promise<NamespaceStats[]> {
  const res = await namespacesQuery(db, ownerId);
  return res.rows as unknown as NamespaceStats[];
}

export async function getNamespace(db: Db, ownerId: string, idOrName: string) {
  const row = await getNamespaceByIdOrName(db, ownerId, idOrName);
  const id = String(row.id);
  // No-FROM select with correlated subqueries.
  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM entities e WHERE e.namespace_id = ${id}) AS entity_count,
      (SELECT count(*)::int FROM memories m WHERE m.namespace_id = ${id}) AS memory_count,
      (SELECT count(*)::int FROM relations r WHERE r.namespace_id = ${id}) AS relation_count
  `);
  return { ...row, ...counts.rows[0] };
}

export async function deleteNamespace(
  db: Db,
  ownerId: string,
  idOrName: string,
) {
  const row = await getNamespaceByIdOrName(db, ownerId, idOrName);
  if (String(row.name) === DEFAULT_NAMESPACE) {
    throw new MemoryError(
      "invalid_input",
      `cannot delete the default namespace '${DEFAULT_NAMESPACE}'`,
    );
  }
  const id = String(row.id);
  const res = await db
    .delete(namespaces)
    .where(and(eq(namespaces.id, id), eq(namespaces.ownerId, ownerId)))
    .returning({ id: namespaces.id, name: namespaces.name });
  // FK cascade removes the rows in Postgres; purge the index too so no ghost
  // docs survive under the dead namespace id (no-op when unconfigured).
  await unsyncByNamespace(id);
  return res[0];
}
