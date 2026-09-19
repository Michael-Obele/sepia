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
 * Escape LIKE metacharacters so user input matches literally.
 *
 * This is load-bearing: without it `q="%"` becomes the pattern `'%%%'`, which
 * matches EVERY row — and on a `batch_update` filter that means rewriting the
 * whole namespace. Postgres defaults the LIKE escape character to backslash, so
 * the rewritten `\%` needs no explicit `ESCAPE` clause (verified against the
 * live database: `ILIKE '%\%%'` and `ILIKE '%\%%' ESCAPE '\'` agree).
 */
export function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

/** Escape regex metacharacters, for pattern-matching a literal term in SQL. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * What a query actually matches on.
 *
 * `terms` are the ranked/coverage terms; `patterns` are the `%term%` LIKE
 * patterns for them. A query with no word characters at all (`"!!!"`) falls
 * back to matching the normalized literal, so `terms` is never empty for a
 * non-empty query and coverage signals stay meaningful.
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
 * `<expr> ILIKE ANY (terms)` — a row may match ANY term. This is the candidate
 * filter for ranked search, where the score then prefers rows covering more
 * terms. Index-supported: the planner turns it into a bitmap index scan on the
 * pg_trgm GIN indexes (verified with `enable_seqscan=off` on the live DB).
 */
export function matchesAnyTerm(expr: SQL, patterns: string[]): SQL {
  return sql`${expr} ILIKE ANY (${textArray(patterns)})`;
}

/**
 * `<expr> ILIKE ALL (terms)` — EVERY term must appear, any order.
 *
 * Used by the *listing* filters (`queryMemories`, `findEntities`): a filter
 * should narrow predictably rather than rank, and this fixes the false zero the
 * single-phrase substring had for natural queries like `q="Jev Bun"` (which
 * required the two words to be adjacent). Ranked search deliberately does NOT
 * use this — requiring every word is what emptied result sets.
 */
export function matchesAllTerms(expr: SQL, q: string): SQL {
  const { patterns } = matchPlan(q);
  return sql`${expr} ILIKE ALL (${textArray(patterns)})`;
}

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
