import type { Db } from "../client.ts";
import { MemoryError } from "../errors.ts";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { namespaces } from "../schema.ts";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WORD_RE = /[\p{L}\p{N}]+/gu;

/**
 * Tokenize a query into the terms matching and ranking use: lowercased, deduped,
 * with single-character terms dropped when longer ones exist (a lone "a" matches
 * nearly every row and inflates coverage). Multi-character-only queries keep
 * their single-character terms, so CJK queries are not emptied.
 */
export function queryTerms(q: string): string[] {
  const all = [
    ...new Set((q.match(WORD_RE) ?? []).map((w) => w.toLowerCase())),
  ];
  if (all.length <= 1) return all;
  const meaningful = all.filter((w) => w.length > 1);
  return meaningful.length ? meaningful : all;
}

/**
 * Escape LIKE metacharacters. Load-bearing: without it `q="%"` matches every row — and on a
 * `batch_update` filter that rewrites the whole namespace. Postgres defaults the escape to
 * backslash, so no explicit `ESCAPE` clause is needed.
 */
export function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

/** Escape regex metacharacters, for pattern-matching a literal term in SQL. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * What a query matches on. A query with no word characters (`"!!!"`) falls back to the
 * literal, so `terms` is never empty and coverage stays meaningful.
 */
export function matchPlan(q: string): { terms: string[]; patterns: string[] } {
  const terms = queryTerms(q);
  if (terms.length) {
    return { terms, patterns: terms.map((t) => `%${escapeLike(t)}%`) };
  }
  const literal = q.trim().replace(/\s+/g, " ");
  return { terms: [literal], patterns: [`%${escapeLike(literal)}%`] };
}

/** drizzle fragment: `ARRAY['%a%','%b%']::text[]` */
export function textArray(values: string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * `ILIKE ANY` — a row may match any term. Index-supported: the planner turns it into a
 * bitmap scan on the pg_trgm GIN indexes.
 */
export function matchesAnyTerm(expr: SQL, patterns: string[]): SQL {
  return sql`${expr} ILIKE ANY (${textArray(patterns)})`;
}

/**
 * `ILIKE ALL` — every term must appear, any order. Used by listing filters, which should
 * narrow predictably rather than rank; ranked search must not use it, because requiring
 * every word is what emptied result sets.
 */
export function matchesAllTerms(expr: SQL, q: string): SQL {
  const { patterns } = matchPlan(q);
  return sql`${expr} ILIKE ALL (${textArray(patterns)})`;
}

/** Resolve a namespace name to its id, owner-scoped, or throw. The tenant boundary. */
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
/**
 * Nullable by-name lookup. The get-or-create path needs "miss" as a VALUE, not
 * an exception — `getNamespaceByIdOrName` throws `namespace_not_found`, which is
 * right for a caller that was handed a name it must honour, and wrong for one
 * deciding whether to create it.
 */
export async function findNamespaceByName(
  db: Db,
  ownerId: string,
  name: string,
) {
  const rows = await db
    .select()
    .from(namespaces)
    .where(and(eq(namespaces.name, name), eq(namespaces.ownerId, ownerId)))
    .limit(1);
  return rows[0];
}

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
