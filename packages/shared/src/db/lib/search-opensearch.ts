/**
 * OpenSearch ranking path — engine #3.
 *
 * Contract with `search()`:
 *   - Returns `SearchHit[]` identical in SHAPE and SEMANTICS to the SQL
 *     engines: `score` higher-is-better (`_score`), `matched_terms` by the
 *     SAME substring arithmetic coverage uses (so `min_terms` and
 *     `summarizeSearch` behave identically), snippets from the same windowing
 *     rules.
 *   - THROWS (OsError / network) when the cluster cannot answer — the caller
 *     falls through to the SQL paths.
 *   - Returns `[]` when the cluster answers empty — the caller ALSO falls
 *     through, so OpenSearch can only change the ORDER of results, never what
 *     is findable. (This is the same safety net the bm25 path has.)
 *
 * Must NOT import from `./search.ts` at runtime (search.ts imports this
 * module — break the cycle by keeping the snippet windowing local; search.ts's
 * `snippet` stays unexported and the two implementations are literal copies —
 * if one changes, change both).
 */
import type { Db } from "../client.ts";
import { SEARCH_LIMIT_MAX } from "../../types.ts";
import { matchPlan, resolveNamespaceId } from "./util.ts";
import { osIndex, osRequest } from "./opensearch-client.ts";
import type { SearchHit } from "./search.ts";

/** Overfetch factor + cap: enough headroom for min_terms filtering + slicing. */
const OVERFETCH = 4;
const OVERFETCH_CAP = 100;

export interface OsSearchOpts {
  q: string;
  namespace?: string;
  type?: string;
  tags?: string[];
  limit?: number;
  min_terms?: number;
}

interface OsHit {
  _score: number;
  _source: Record<string, unknown>;
}

interface OsResp {
  hits?: { hits?: OsHit[] };
}

/**
 * Pure DSL builder — unit-tested without a cluster.
 *
 * Query shape mirrors coverage's semantics:
 *   filter    → tenant + namespace + type + tags-ALL (the `@>` containment)
 *   must_not  → archived rows (coverage: `archived IS NOT TRUE`)
 *   should    → one `match` per term + a phrase match for the verbatim bonus,
 *               minimum_should_match 1 = best-effort recall (never emptied by
 *               one absent word — the project's core search invariant)
 *   sort      → score, then importance, then recency (coverage's tie-breaks)
 */
export function buildOsQuery(
  ownerId: string,
  opts: OsSearchOpts,
  nsId?: string,
): Record<string, unknown> {
  // Same cap as the SQL engines — a caller must not get a bigger page from
  // engine=opensearch than from coverage (cross-engine shape divergence).
  const limit = Math.min(opts.limit ?? 10, SEARCH_LIMIT_MAX);
  const size = Math.min(limit * OVERFETCH, OVERFETCH_CAP);
  const { terms } = matchPlan(opts.q);
  const filter: Record<string, unknown>[] = [{ term: { owner_id: ownerId } }];
  if (nsId !== undefined) filter.push({ term: { namespace_id: nsId } });
  if (opts.type !== undefined) filter.push({ term: { type: opts.type } });
  for (const t of opts.tags ?? []) filter.push({ term: { tags: t } });
  const should: Record<string, unknown>[] = terms.map((t) => ({
    match: { haystack: t },
  }));
  should.push({ match_phrase: { haystack: opts.q.trim() } });
  return {
    query: {
      bool: {
        filter,
        must_not: [{ term: { archived: true } }],
        should,
        minimum_should_match: 1,
      },
    },
    sort: ["_score", { importance: "desc" }, { updated_at: "desc" }],
    size,
  };
}

/** Snippet window centred on the first matching term — mirrors search.ts. */
function snippetWindow(text: string, terms: string[]): string {
  const flat = text.trim().replace(/\s+/g, " ");
  if (flat.length <= 200) return flat;
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return `${flat.slice(0, 199)}…`;
  const width = 198;
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
 * Raw OpenSearch hits → SearchHit[] with coverage-compatible semantics.
 * Pure (no I/O) so unit tests can pin: matched_terms by substring,
 * min_terms filtering, dedupe by kind:id, limit slicing, score direction.
 */
export function mapHits(
  raw: OsHit[],
  terms: string[],
  limit: number,
  minTerms: number | null,
): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const h of raw) {
    const s = h._source ?? {};
    const kind = String(s.kind ?? "memory");
    const id = String(s.id ?? "");
    const key = `${kind}:${id}`;
    if (!id || seen.has(key)) continue;
    seen.add(key);
    const haystack = String(s.haystack ?? "");
    const lower = haystack.toLowerCase();
    // Same arithmetic as coverage's `sc.matched`: substring, case-insensitive,
    // terms already lowercased by queryTerms.
    const matched = terms.filter((t) => lower.includes(t)).length;
    if (minTerms !== null && matched < minTerms) continue;
    const isMemory = kind === "memory";
    const content =
      s.content === undefined || s.content === null
        ? undefined
        : String(s.content);
    const name =
      s.name === undefined || s.name === null ? undefined : String(s.name);
    // Mirror coverage's snippet choice: memories snippet their content when
    // the match lives there, else the full haystack; entities always haystack.
    const snippetSource =
      isMemory &&
      content &&
      terms.some((t) => content.toLowerCase().includes(t))
        ? content
        : haystack;
    hits.push({
      kind: isMemory ? "memory" : "entity",
      id,
      name,
      content,
      type: String(s.type ?? ""),
      importance: Number(s.importance ?? 0),
      updated_at: String(s.updated_at ?? ""),
      namespace: String(s.namespace ?? ""),
      snippet: snippetWindow(snippetSource, terms),
      score: Number(h._score ?? 0),
      matched_terms: matched,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * One search against OpenSearch. Throws on cluster failure — `search()`
 * catches and falls through to coverage. Namespace resolution happens first
 * so a typo'd namespace behaves identically on every engine (the false-zero
 * guard in search()'s `finish()` remains the backstop).
 */
export async function searchOpenSearch(
  db: Db,
  ownerId: string,
  opts: OsSearchOpts,
): Promise<SearchHit[]> {
  const nsId =
    opts.namespace !== undefined
      ? await resolveNamespaceId(db, ownerId, opts.namespace)
      : undefined;
  const { terms } = matchPlan(opts.q);
  const limit = Math.min(opts.limit ?? 10, SEARCH_LIMIT_MAX);
  const body = buildOsQuery(ownerId, opts, nsId);
  const res = await osRequest<OsResp>("POST", `/${osIndex()}/_search`, body);
  return mapHits(res.hits?.hits ?? [], terms, limit, opts.min_terms ?? null);
}
