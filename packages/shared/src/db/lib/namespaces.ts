import type { Db } from "../client.ts";
import { MemoryError } from "../errors.ts";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { namespaces } from "../schema.ts";
import { DEFAULT_NAMESPACE } from "../../types.ts";
import { findNamespaceByName, getNamespaceByIdOrName } from "./util.ts";
import { assertNamespaceQuota } from "./plans.ts";

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
 * Get-or-create, idempotent: the one call a session makes to say "I am in this repo". `create`
 * alone forces every caller through a failure branch (get, miss, create, `already_exists`
 * race), which is the difference between a model that scopes itself and one that gives up at
 * the first error. Quota is only asserted on the create path, so an existing namespace always
 * resolves even at the plan limit.
 */
export async function ensureNamespace(
  db: Db,
  ownerId: string,
  name: string,
  description = "",
  plan?: string | null,
): Promise<{ namespace: Awaited<ReturnType<typeof getNamespace>>; created: boolean }> {
  const existing = await findNamespaceByName(db, ownerId, name);
  if (existing) {
    return {
      namespace: await getNamespace(db, ownerId, String(existing.id)),
      created: false,
    };
  }
  await assertNamespaceQuota(db, ownerId, plan);
  const rows = await db
    .insert(namespaces)
    .values({ ownerId, name, description })
    .onConflictDoNothing()
    .returning();
  const id = rows[0]?.id;
  // Lost a create race: the row is there now, which is the answer we wanted.
  const resolved = id
    ? String(id)
    : String((await findNamespaceByName(db, ownerId, name))!.id);
  return {
    namespace: await getNamespace(db, ownerId, resolved),
    created: Boolean(id),
  };
}

/** Rename and/or describe. The rename path keeps the per-owner name uniqueness. */
export async function updateNamespace(
  db: Db,
  ownerId: string,
  idOrName: string,
  changes: { name?: string; description?: string },
) {
  const row = await getNamespaceByIdOrName(db, ownerId, idOrName);
  // `sql`now()`` rather than a JS Date: the column is `mode: "string"`, so a
  // Date here is a type mismatch the driver would coerce silently.
  const sets: {
    name?: string;
    description?: string;
    updatedAt: SQL;
  } = { updatedAt: sql`now()` };
  if (changes.name !== undefined) sets.name = changes.name;
  if (changes.description !== undefined) sets.description = changes.description;
  const updated = await db
    .update(namespaces)
    .set(sets)
    .where(and(eq(namespaces.id, String(row.id)), eq(namespaces.ownerId, ownerId)))
    .returning();
  if (!updated[0]) {
    // Almost always the unique index: another namespace already owns that name.
    throw new MemoryError(
      "already_exists",
      `namespace '${changes.name}' already exists (use manage_namespace action=list to see namespaces)`,
    );
  }
  return getNamespace(db, ownerId, String(row.id));
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
  return res[0];
}
