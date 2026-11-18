import type { Db } from "../client.ts";
import { sql } from "drizzle-orm";
import { memories, namespaces } from "../schema.ts";
import {
  PURGE_AFTER_DAYS,
  STALE_AFTER_DAYS,
  STALE_IMPORTANCE,
} from "../../types.ts";

export interface PruneMemoriesResult {
  archived_stale: number;
  archived_duplicates: number;
  purged: number;
}

/**
 * Idempotent maintenance sweep, pure SQL, scoped to the owner's namespaces. Named `prune` because
 * `consolidate` read like the primary "save memory" action and models called it by default.
 * Archives stale rows (importance < 0.3, 90d) — never conversation digests, which are handoff
 * entry points; dedupes per namespace keeping the highest importance; purges archived rows past 30d.
 */
export async function pruneMemories(
  db: Db,
  ownerId: string,
): Promise<PruneMemoriesResult> {
  const stale = await db.execute(sql`
    UPDATE ${memories} SET archived = true, updated_at = now()
    WHERE NOT archived
      AND importance < ${STALE_IMPORTANCE}
      AND updated_at < now() - (${STALE_AFTER_DAYS} * interval '1 day')
      AND (metadata->>'kind') IS DISTINCT FROM 'conversation'
      AND namespace_id IN (SELECT id FROM ${namespaces} WHERE owner_id = ${ownerId})
    RETURNING id
  `);

  const duplicates = await db.execute(sql`
    UPDATE ${memories} m SET archived = true, updated_at = now()
    WHERE NOT m.archived
      AND m.namespace_id IN (SELECT id FROM ${namespaces} WHERE owner_id = ${ownerId})
      AND EXISTS (
        SELECT 1 FROM ${memories} k
        WHERE k.namespace_id = m.namespace_id
          AND lower(btrim(k.content)) = lower(btrim(m.content))
          AND (
            k.importance > m.importance
            OR (k.importance = m.importance AND k.created_at < m.created_at)
            OR (k.importance = m.importance AND k.created_at = m.created_at AND k.id < m.id)
          )
      )
    RETURNING id
  `);

  const purged = await db.execute(sql`
    DELETE FROM ${memories}
    WHERE archived
      AND updated_at < now() - (${PURGE_AFTER_DAYS} * interval '1 day')
      AND namespace_id IN (SELECT id FROM ${namespaces} WHERE owner_id = ${ownerId})
    RETURNING id
  `);

  return {
    archived_stale: stale.rows.length,
    archived_duplicates: duplicates.rows.length,
    purged: purged.rows.length,
  };
}
