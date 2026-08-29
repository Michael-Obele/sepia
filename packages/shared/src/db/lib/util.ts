import type { Db } from "../client.ts";
import { MemoryError } from "../errors.ts";
import { and, eq } from "drizzle-orm";
import { namespaces } from "../schema.ts";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a namespace by name to its id, scoped to the owner, or throw.
 * Every data access goes through here — this is the tenant boundary.
 */
export async function resolveNamespaceId(
  db: Db,
  ownerId: string,
  name: string,
): Promise<string> {
  const rows = await db
    .select({ id: namespaces.id })
    .from(namespaces)
    .where(and(eq(namespaces.name, name), eq(namespaces.ownerId, ownerId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new MemoryError(
      "namespace_not_found",
      `namespace '${name}' does not exist (create it with manage_namespace)`,
    );
  }
  return String(row.id);
}

/** Fetch a namespace row by id or name, scoped to the owner. */
export async function getNamespaceByIdOrName(
  db: Db,
  ownerId: string,
  idOrName: string,
) {
  const rows = UUID_RE.test(idOrName)
    ? await db
        .select()
        .from(namespaces)
        .where(
          and(eq(namespaces.id, idOrName), eq(namespaces.ownerId, ownerId)),
        )
        .limit(1)
    : await db
        .select()
        .from(namespaces)
        .where(
          and(eq(namespaces.name, idOrName), eq(namespaces.ownerId, ownerId)),
        )
        .limit(1);
  const row = rows[0];
  if (!row) {
    throw new MemoryError("not_found", `namespace '${idOrName}' not found`);
  }
  return row;
}
