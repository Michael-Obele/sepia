import type { Db } from "../client.ts";
import { SEARCH_LIMIT_MAX, type SearchEngine } from "../../types.ts";
import { and, desc, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { entities, memories, namespaces } from "../schema.ts";
import {
  escapeLike,
  escapeRegExp,
  matchPlan,
  matchesAnyTerm,
  resolveNamespaceId,
  textArray,
} from "./util.ts";
/**
 * `coverage` = substring, coverage-first. `bm25` = the generated tsvector columns,
 * prefix-aware. Explicit option wins, then `SEARCH_ENGINE`, then coverage: bm25 is a
 * different ranking model, so it is measured before being defaulted. Both engines can
 * reorder results, never lose them.
 */
export function resolveSearchEngine(
  opts: {
    engine?: SearchEngine;
  } = {},
): SearchEngine {
  const wanted = opts.engine ?? process.env.SEARCH_ENGINE;
  return wanted === "bm25" ? "bm25" : "coverage";
}

export interface SearchOptions {
  q: string;
  namespace?: string;
  type?: string;
  /** match memories/entities carrying ALL of these tags */
  tags?: string[];
  limit?: number;
  /** Drop hits covering fewer than this many terms. Filtered in SQL before the LIMIT. */
  min_terms?: number;
  /** which ranking engine to use; default from `SEARCH_ENGINE`, else coverage */
  engine?: SearchEngine;
}

export interface SearchHit {
  kind: "memory" | "entity";
  id: string;
  name?: string;
  content?: string;
  type: string;
  importance: number;
  updated_at: string;
  namespace: string;
  snippet: string;
  /**
   * `coverage_weight x matched_terms` + word/phrase bonuses, weighted by query length so
   * coverage always dominates. That is what makes the top hit's `matched_terms` the max.
   */
  score: number;
  /** How many query terms this row matched. `0` on the empty-query (recent) path. */
  matched_terms: number;
}

/**
 * `partial: true` means best-effort recall, not an exhaustive answer — re-ask with
 * `min_terms` set to `best_matched_terms` for precision.
 */
export function summarizeSearch(
  q: string,
  hits: SearchHit[],
): { terms: string[]; best_matched_terms: number; partial: boolean } {
  // Empty query = recent-items path: nothing ranked, so nothing is partial. Without
  // this, matchPlan's literal fallback would report every recent call as 0-of-1.
  if (!q.trim()) return { terms: [], best_matched_terms: 0, partial: false };
  const { terms } = matchPlan(q);
  const best = hits.reduce((n, h) => Math.max(n, h.matched_terms), 0);
  return {
    terms,
    best_matched_terms: best,
    // Equivalent to `hits.every(h => h.matched_terms < terms.length)` — `best`
    // IS that maximum — but computed once rather than per hit, and still correct
    // if the scoring weights ever change.
    partial: hits.length > 0 && best < terms.length,
  };
}

/** Does `text` contain any of `terms` as a substring? */
function containsAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

/**
 * Snippet window centred on the first matching term, so a reader (or a model)
 * can see WHY the row matched instead of 200 chars of unrelated preamble.
 * Falls back to the head of the text when no term matches in the visible part.
 */
function snippet(text: string, terms: string[], max = 200): string {
  const flat = text.trim().replace(/\s+/g, " ");
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return `${flat.slice(0, max - 1)}…`;
  // Centre the window on the match, reserving room for the ellipses so the
  // result never exceeds `max`; a side without an ellipsis gets the slack back.
  const width = max - 2;
  let start = Math.max(
    0,
    Math.min(at - Math.floor(width / 2), flat.length - width),
  );
  let end = start + width;
  if (start === 0) end = Math.min(flat.length, end + 1);
  else if (end >= flat.length) start = Math.max(0, start - 1);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/**
 * Search memories.content, entities.name/summary and memory metadata (minus `transcript`).
 * Ranked, never emptied by one absent word: coverage dominates, whole-word beats substring,
 * a verbatim phrase adds 5, then importance and recency break ties. Scoring runs in SQL so
 * the LIMIT applies to the RANKED set — ranking in JS after a recent-first window dropped
 * the best match whenever more than `4 x limit` rows matched. Empty `q` returns recent items.
 */
export async function search(
  db: Db,
  ownerId: string,
  opts: SearchOptions,
): Promise<SearchHit[]> {
  const limit = Math.min(opts.limit ?? 10, SEARCH_LIMIT_MAX);

  if (!opts.q.trim()) {
    // Recent-items path: still honor namespace + tags filters so tag-only
    // searches work (e.g. q="" + tags=["user-experience"]).
    const memConditions = [
      sql`${memories.archived} IS NOT TRUE`,
      eq(namespaces.ownerId, ownerId),
    ];
    const entConditions: SQL[] = [eq(namespaces.ownerId, ownerId)];
    if (opts.namespace !== undefined) {
      const nsId = await resolveNamespaceId(db, ownerId, opts.namespace);
      memConditions.push(eq(memories.namespaceId, nsId));
      entConditions.push(eq(entities.namespaceId, nsId));
    }
    if (opts.type !== undefined) {
      memConditions.push(eq(memories.type, opts.type));
      entConditions.push(eq(entities.type, opts.type));
    }
    if (opts.tags !== undefined && opts.tags.length) {
      const tagArray = sql`ARRAY[${sql.join(
        opts.tags.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[]`;
      memConditions.push(sql`${memories.tags} @> ${tagArray}`);
      entConditions.push(sql`${entities.tags} @> ${tagArray}`);
    }
    const [memoriesRows, entitiesRows] = await Promise.all([
      db
        .select({
          ...getTableColumns(memories),
          namespace: namespaces.name,
        })
        .from(memories)
        .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
        .where(and(...memConditions))
        .orderBy(desc(memories.updatedAt))
        .limit(limit),
      db
        .select({
          ...getTableColumns(entities),
          namespace: namespaces.name,
        })
        .from(entities)
        .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId))
        .where(entConditions.length ? and(...entConditions) : undefined)
        .orderBy(desc(entities.updatedAt))
        .limit(limit),
    ]);
    const hits = [
      ...memoriesRows.map((m) => ({
        kind: "memory" as const,
        id: String(m.id),
        content: String(m.content),
        type: String(m.type),
        importance: Number(m.importance),
        updated_at: String(m.updatedAt),
        namespace: String(m.namespace),
        snippet: snippet(String(m.content), []),
        score: 0,
        matched_terms: 0,
      })),
      ...entitiesRows.map((e) => ({
        kind: "entity" as const,
        id: String(e.id),
        name: String(e.name),
        type: String(e.type),
        importance: Number(e.importance),
        updated_at: String(e.updatedAt),
        namespace: String(e.namespace),
        snippet: snippet(String(e.summary ?? e.name), []),
        score: 0,
        matched_terms: 0,
      })),
    ];
    hits.sort((a, b) =>
      String(b.updated_at).localeCompare(String(a.updated_at)),
    );
    return hits.slice(0, limit);
  }

  // Terms + LIKE patterns for the query. A punctuation-only query ("!!!") has
  // no word terms and falls back to matching the literal, so a non-empty query
  // always yields at least one term (and coverage stays meaningful).
  const { terms, patterns } = matchPlan(opts.q);
  const wordRegexes = terms.map((t) => `\\y${escapeRegExp(t)}\\y`);
  // Normalized phrase for the verbatim-match bonus.
  const phrase = `%${escapeLike(opts.q.trim().toLowerCase().replace(/\s+/g, " "))}%`;

  const likeArray = textArray(patterns);
  const regexArray = textArray(wordRegexes);
  // Coverage weight: strictly greater than the largest bonus any single row can
  // accumulate (10 per whole-word match + 5 for the phrase), for any term count.
  const coverageWeight = 20 * terms.length + 100;

  // The only metadata worth matching: digest `title`, `conversation_id`, `source_ai`. Named
  // fields, not `metadata::text` — the whole-JSON form matched KEY names and swept in the
  // verbatim `transcript`, which is fidelity-only and would match nearly any query.
  const memMeta = sql`(COALESCE(m.metadata->>'title', '') || ' ' || COALESCE(m.metadata->>'conversation_id', '') || ' ' || COALESCE(m.metadata->>'source_ai', ''))`;
  const memHaystack = sql`(m.content || ' ' || ${memMeta})`;
  const entHaystack = sql`(e.name || ' ' || COALESCE(e.summary, ''))`;
  // Candidate prefilters, one per indexed column — a bare ILIKE can be served by
  // the pg_trgm GIN indexes, an ILIKE over the concatenated haystack cannot.
  // NB: an OR against an UNINDEXED expression costs the planner the index for
  // the whole predicate, which is why this metadata expression carries its own
  // trgm index (`memories_metadata_trgm` in schema.ts).
  const memAny = sql`(${matchesAnyTerm(sql`m.content`, patterns)} OR ${matchesAnyTerm(memMeta, patterns)})`;
  // `e.summary` is deliberately NOT wrapped in COALESCE: the wrapper would be a
  // different expression than the one idx_entities_summary_trgm indexes, so the
  // index could not serve it (a NULL mismatch is harmless inside an OR).
  const entAny = sql`(${matchesAnyTerm(sql`e.name`, patterns)} OR ${matchesAnyTerm(sql`e.summary`, patterns)})`;

  // Each UNION branch has a different alias (m vs e) — build predicates
  // per-branch (a shared one referencing both aliases is invalid SQL).
  const memWhere: SQL[] = [sql`n.owner_id = ${ownerId}`];
  const entWhere: SQL[] = [sql`n.owner_id = ${ownerId}`];
  if (opts.namespace !== undefined) {
    memWhere.push(sql`n.name = ${opts.namespace}`);
    entWhere.push(sql`n.name = ${opts.namespace}`);
  }
  if (opts.type !== undefined) {
    memWhere.push(sql`m.type = ${opts.type}`);
    entWhere.push(sql`e.type = ${opts.type}`);
  }
  if (opts.tags !== undefined && opts.tags.length) {
    const tagArray = sql`ARRAY[${sql.join(
      opts.tags.map((t) => sql`${t}`),
      sql`, `,
    )}]::text[]`;
    memWhere.push(sql`m.tags @> ${tagArray}`);
    entWhere.push(sql`e.tags @> ${tagArray}`);
  }
  const memWhereSql = sql`AND ${sql.join(memWhere, sql` AND `)}`;
  const entWhereSql = sql`AND ${sql.join(entWhere, sql` AND `)}`;

  // Precision dial, applied in SQL before the LIMIT so a narrowed search still fills
  // the page from surviving rows.
  const minTerms = opts.min_terms ?? null;

  /** Shared shape for both engines. `score` is always higher-is-better (BM25 negates). */
  const toHits = (rows: Array<Record<string, unknown>>): SearchHit[] => {
    const hits: SearchHit[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const kind = row.kind as "memory" | "entity";
      const key = `${kind}:${String(row.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const haystack = String(row.haystack ?? "");
      const name =
        row.name === null || row.name === undefined
          ? undefined
          : String(row.name);
      const content =
        row.content === null || row.content === undefined
          ? undefined
          : String(row.content);
      hits.push({
        kind,
        id: String(row.id),
        name,
        content,
        type: String(row.type),
        importance: Number(row.importance),
        updated_at: String(row.updated_at),
        namespace: String(row.namespace),
        // Snippet the content when the match is in it; otherwise the haystack, so a
        // metadata-only match never looks unexplained.
        snippet:
          kind === "memory" && content && containsAny(content, terms)
            ? snippet(content, terms)
            : snippet(haystack, terms),
        score: Number(row.score),
        matched_terms: Number(row.matched),
      });
    }
    return hits;
  };

  /** A typo'd namespace must not look like "no memories exist". Only checked when empty. */
  const finish = async (hits: SearchHit[]): Promise<SearchHit[]> => {
    if (hits.length === 0 && opts.namespace !== undefined) {
      await resolveNamespaceId(db, ownerId, opts.namespace);
    }
    return hits;
  };

  // BM25 needs word-like terms only (a punctuation-only query falls back to the
  // literal, which `to_tsquery` would choke on) and ONE term per lexeme joined by
  // `|`. Never a space-separated string: websearch_to_tsquery ANDs words, so one
  // absent word returns 0 candidates — the false-zero bug fixed once already.
  const wordTerms = terms.filter((t) => /^[\p{L}\p{N}]+$/u.test(t));
  if (
    resolveSearchEngine(opts) === "bm25" &&
    terms.length > 0 &&
    wordTerms.length === terms.length
  ) {
    // `term:*` matches any lexeme STARTING WITH the term, which is what keeps
    // prefix and compound-word recall alive without a trigram index.
    const prefixTerms = wordTerms.map((t) => `${t}:*`);
    const prefixOr = prefixTerms.join(" | ");
    const prefixArray = textArray(prefixTerms);
    const bm = await db.execute(sql`
      WITH src AS (
        SELECT 'memory' AS kind, m.id, NULL::text AS name, m.content AS content,
               m.type, m.importance, m.updated_at, n.name AS namespace,
               ${memHaystack} AS haystack,
               m.content_tsv AS tsv,
               m.content_tsv <@> to_bm25query(to_tsvector('english', ${opts.q}), 'memories_content_bm25') AS bm
          FROM ${memories} m JOIN ${namespaces} n ON n.id = m.namespace_id
         WHERE m.archived IS NOT TRUE
           AND m.content_tsv @@ to_tsquery('english', ${prefixOr})
           ${memWhereSql}
        UNION ALL
        SELECT 'entity', e.id, e.name, NULL::text, e.type, e.importance,
               e.updated_at, n.name, ${entHaystack},
               e.haystack_tsv,
               e.haystack_tsv <@> to_bm25query(to_tsvector('english', ${opts.q}), 'entities_haystack_bm25')
          FROM ${entities} e JOIN ${namespaces} n ON n.id = e.namespace_id
         WHERE e.haystack_tsv @@ to_tsquery('english', ${prefixOr})
           ${entWhereSql}
      )
      SELECT src.*, (- src.bm) AS score,
             (SELECT COUNT(*) FROM unnest(${prefixArray}) AS t(term)
               WHERE src.tsv @@ to_tsquery('english', t.term)) AS matched
        FROM src
       WHERE ${minTerms}::int IS NULL
          OR (SELECT COUNT(*) FROM unnest(${prefixArray}) AS t(term)
                WHERE src.tsv @@ to_tsquery('english', t.term)) >= ${minTerms}::int
       ORDER BY score DESC NULLS LAST, src.importance DESC NULLS LAST,
                src.updated_at DESC
       LIMIT ${limit}
    `);
    const bmHits = toHits(bm.rows as Array<Record<string, unknown>>);
    // Safety net: a ranked miss falls through to the substring path instead of
    // answering "nothing", so changing the engine can never lose recall outright
    // — it only changes the order. Costs a second query ONLY when BM25 is empty.
    if (bmHits.length) return finish(bmHits);
  }

  const res = await db.execute(sql`
    SELECT src.kind, src.id, src.name, src.content, src.type, src.importance,
           src.updated_at, src.namespace, src.haystack,
           COALESCE(sc.matched, 0) AS matched,
           COALESCE(sc.matched, 0) * ${coverageWeight}
             + COALESCE(sc.whole, 0) * 10
             + (CASE WHEN src.haystack ILIKE ${phrase} ESCAPE '\\' THEN 5 ELSE 0 END) AS score
      FROM (
        SELECT 'memory' AS kind, m.id, NULL::text AS name, m.content AS content,
               m.type, m.importance, m.updated_at, n.name AS namespace,
               ${memHaystack} AS haystack
          FROM ${memories} m JOIN ${namespaces} n ON n.id = m.namespace_id
         WHERE m.archived IS NOT TRUE AND ${memAny} ${memWhereSql}
        UNION ALL
        SELECT 'entity' AS kind, e.id, e.name, NULL::text AS content,
               e.type, e.importance, e.updated_at, n.name AS namespace,
               ${entHaystack} AS haystack
          FROM ${entities} e JOIN ${namespaces} n ON n.id = e.namespace_id
         WHERE ${entAny} ${entWhereSql}
      ) AS src
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS matched,
               COUNT(*) FILTER (WHERE src.haystack ~* w.rx) AS whole
          FROM unnest(${likeArray}, ${regexArray}) AS w(pat, rx)
         WHERE src.haystack ILIKE w.pat
      ) AS sc ON TRUE
     WHERE ${minTerms}::int IS NULL OR COALESCE(sc.matched, 0) >= ${minTerms}::int
     ORDER BY score DESC, src.importance DESC NULLS LAST, src.updated_at DESC
     LIMIT ${limit}
  `);
  return finish(toHits(res.rows as Array<Record<string, unknown>>));
}
