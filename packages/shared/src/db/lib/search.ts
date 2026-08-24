import type { Db } from "../client.ts";
import { SEARCH_LIMIT_MAX } from "../../types.ts";
import { and, desc, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { entities, memories, namespaces } from "../schema.ts";
import { resolveNamespaceId } from "./util.ts";

export interface SearchOptions {
  q: string;
  namespace?: string;
  type?: string;
  /** match memories/entities carrying ALL of these tags */
  tags?: string[];
  limit?: number;
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
  score: number;
}

const WORD_RE = /[a-z0-9]+/gi;

/** 2 points per exact whole-word match, 1 per substring match, +2 if the full phrase matches verbatim. */
function matchScore(text: string, words: string[], phrase: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (lower.includes(word)) score += 1;
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}([^a-z0-9]|$)`);
    if (re.test(lower)) score += 1;
  }
  if (phrase && lower.includes(phrase)) score += 2;
  return score;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function snippet(text: string, max = 200): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Unified search over memories.content, entities.name, entities.summary.
 * Case-insensitive substring matching in SQL, then ranked in JS:
 * exact word match > substring match, then importance DESC, then
 * updated_at DESC. Empty `q` returns recent items.
 *
 * Multi-word queries require EVERY word to appear (AND, any order) — the
 * old single-phrase ILIKE returned 0 for natural queries like
 * "bun runtime preference". Exact-phrase matches still rank first via the
 * phrase bonus in matchScore.
 */
export async function search(
  db: Db,
  opts: SearchOptions,
): Promise<SearchHit[]> {
  const limit = Math.min(opts.limit ?? 10, SEARCH_LIMIT_MAX);

  if (!opts.q.trim()) {
    // Recent-items path: still honor namespace + tags filters so tag-only
    // searches work (e.g. q="" + tags=["user-experience"]).
    const memConditions = [eq(memories.archived, false)];
    const entConditions: SQL[] = [];
    if (opts.namespace !== undefined) {
      const nsId = await resolveNamespaceId(db, opts.namespace);
      memConditions.push(eq(memories.namespaceId, nsId));
      entConditions.push(eq(entities.namespaceId, nsId));
    }
    if (opts.tags !== undefined && opts.tags.length) {
      const tagArray = sql`ARRAY[${sql.join(opts.tags.map((t) => sql`${t}`), sql`, `)}]::text[]`;
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
        snippet: snippet(String(m.content)),
        score: 0,
      })),
      ...entitiesRows.map((e) => ({
        kind: "entity" as const,
        id: String(e.id),
        name: String(e.name),
        type: String(e.type),
        importance: Number(e.importance),
        updated_at: String(e.updatedAt),
        namespace: String(e.namespace),
        snippet: snippet(String(e.summary ?? e.name)),
        score: 0,
      })),
    ];
    hits.sort((a, b) =>
      String(b.updated_at).localeCompare(String(a.updated_at)),
    );
    return hits.slice(0, limit);
  }

  const words = (opts.q.match(WORD_RE) ?? []).map((w) => w.toLowerCase());
  // Escape LIKE metacharacters so input matches literally.
  const like = `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`;
  // AND-of-words filter: every word must appear, any order. Words come from
  // WORD_RE so they are alphanumeric-only — no LIKE metacharacters to escape.
  // Falls back to the phrase filter when the query has no words (e.g. "!!!").
  const wordArray = words.length
    ? sql`ARRAY[${sql.join(words.map((w) => sql`${`%${w}%`}`), sql`, `)}]::text[]`
    : null;
  const memWordFilter = wordArray
    ? sql`AND m.content ILIKE ALL (${wordArray})`
    : sql`AND m.content ILIKE ${like} ESCAPE '\\'`;
  const entWordFilter = wordArray
    ? sql`(e.name ILIKE ALL (${wordArray}) OR e.summary ILIKE ALL (${wordArray}))`
    : sql`(e.name ILIKE ${like} ESCAPE '\\' OR e.summary ILIKE ${like} ESCAPE '\\')`;
  // Normalized phrase for the exact-match ranking bonus.
  const phrase = opts.q.trim().toLowerCase().replace(/\s+/g, " ");

  // Each UNION branch has a different alias (m vs e) — build predicates
  // per-branch (a shared one referencing both aliases is invalid SQL).
  const memWhere: SQL[] = [];
  const entWhere: SQL[] = [];
  if (opts.namespace !== undefined) {
    memWhere.push(sql`n.name = ${opts.namespace}`);
    entWhere.push(sql`n.name = ${opts.namespace}`);
  }
  if (opts.type !== undefined) {
    memWhere.push(sql`m.type = ${opts.type}`);
    entWhere.push(sql`e.type = ${opts.type}`);
  }
  if (opts.tags !== undefined && opts.tags.length) {
    const tagArray = sql`ARRAY[${sql.join(opts.tags.map((t) => sql`${t}`), sql`, `)}]::text[]`;
    memWhere.push(sql`m.tags @> ${tagArray}`);
    entWhere.push(sql`e.tags @> ${tagArray}`);
  }
  const memWhereSql = memWhere.length
    ? sql`AND ${sql.join(memWhere, sql` AND `)}`
    : sql``;
  const entWhereSql = entWhere.length
    ? sql`AND ${sql.join(entWhere, sql` AND `)}`
    : sql``;

  const res = await db.execute(sql`
    SELECT 'memory' AS kind, m.id, m.content AS text, m.type, m.importance, m.updated_at, n.name AS namespace
      FROM ${memories} m JOIN ${namespaces} n ON n.id = m.namespace_id
      WHERE NOT m.archived ${memWordFilter} ${memWhereSql}
    UNION ALL
    SELECT 'entity' AS kind, e.id, e.name AS text, e.type, e.importance, e.updated_at, n.name AS namespace
      FROM ${entities} e JOIN ${namespaces} n ON n.id = e.namespace_id
      WHERE ${entWordFilter} ${entWhereSql}
    ORDER BY updated_at DESC
    LIMIT ${limit * 4}
  `);
  const rows = res.rows as Array<Record<string, unknown>>;

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const kind = row.kind as "memory" | "entity";
    const key = `${kind}:${String(row.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = String(row.text);
    const score = matchScore(text, words, phrase);
    hits.push({
      kind,
      id: String(row.id),
      name: kind === "entity" ? text : undefined,
      content: kind === "memory" ? text : undefined,
      type: String(row.type),
      importance: Number(row.importance),
      updated_at: String(row.updated_at),
      namespace: String(row.namespace),
      snippet: snippet(text),
      score,
    });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      b.importance - a.importance ||
      String(b.updated_at).localeCompare(String(a.updated_at)),
  );
  return hits.slice(0, limit);
}
