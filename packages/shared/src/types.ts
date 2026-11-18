/**
 * Constants shared by the server, the dashboard, and the skill reference
 * generator. Single source of truth for domain values.
 */

/** Default namespace for all tools when none is specified. */
export const DEFAULT_NAMESPACE = "personal";

/**
 * The `sepia_` credential prefix, so a key is recognisable in a log or to a secret
 * scanner. Lives here, not in the DB layer, because the dashboard renders it — this
 * module imports nothing, which is what makes it safe in a browser bundle.
 */
export const API_KEY_PREFIX = "sepia_";

/**
 * The memory contract: sent via the MCP `instructions` field, carried by the Agent
 * Skill, and shown on the dashboard's Connect page for web AIs that ignore it.
 * Source of truth is this constant; `src/instructions.ts` re-exports it.
 */
export const MEMORY_CONTRACT = `SEPIA MEMORY — MANDATORY. You are connected to Sepia, the user's memory
server, over MCP at /mcp. It stores a knowledge graph in **namespaces**: entities (people,
projects, tools, concepts, repos), relations (directed edges) and memories
(fact | observation | preference | instruction, each with importance 0-1).

ONCE PER SESSION, BEFORE ANY WORK
1. wake — retry up to 3x a few seconds apart. The host sleeps when idle, so one failure means
   you called during boot, not that memory is down.
2. manage_memory action="briefing" — the user's standing rules. No keywords: a rule you have not
   guessed cannot be found by search, which is why this read is unconditional. Treat what it
   returns as binding. Before anything slow, metered, destructive or expensive (install, build,
   deploy, delete, infra change), repeat it with detail="all".
Neither repeats on later messages in the same chat.

SCOPE EVERY CALL TO THE PROJECT
Namespaces are one per project, named by repo slug (kazoeru, ikoro, tomoshibi). "personal" is the
cross-project bucket and the only namespace the free plan has.
1. manage_namespace action="ensure" name="<repo-slug>" once per session. It is get-or-create, so
   "already exists" is never an error to recover from.
2. Pass namespace="<repo-slug>" on EVERY memory, entity, relation, briefing and query call. A write
   with no namespace lands in "personal" — the one mistake that rebuilds the noise scoping exists
   to remove.
3. Tag a rule "always" only when it applies in every repo and every session; those load in every
   namespace. Anything project-specific stays in that project.
4. plan_limit from ensure or create? Stay in "personal" and carry on. Do not retry, and do not ask
   the user to upgrade mid-task.

EVERY TURN — RECALL
Call search with 2-5 keywords from the request BEFORE you answer. Skip only for trivial chitchat.
Zero hits, or partial:true, means retry with ONE distinctive word before concluding nothing exists
— then say so. Never fabricate a memory. Cite what came from memory when it matters.
identical results for different q values means the filter was NOT applied: check
filters_applied / ignored_args before blaming ranking.

EVERY TURN — PERSIST
After you answer, store anything durable in the SAME turn: a preference, a decision and its reason,
a project fact, a person's role, a convention, a stack choice, a correction. A correction or a
complaint about how you just worked is a rule — instruction for behaviour, preference for a choice,
importance >= 0.8. Search first, then action=update rather than writing a duplicate. Entity before
memory, 1-3 entity_ids, then manage_relation to wire the graph. Never store credentials, secrets,
ephemeral chat or code snippets.

"SAVE THIS" MEANS SEPIA
"save to memory", "remember this", "save this" — write to Sepia in that same turn, never the
editor's built-in memory. It is the durable source of truth across sessions, editors and AIs.

NEVER
prune_memories is the only destructive tool. Never call it to save anything, and never proactively —
only when the user explicitly asks to prune. Saving is manage_memory.

Full contract, tool reference and the scoping guide: the "sepia" Agent Skill.
`;

/**
 * The short form, for surfaces that take a pasteable block (a web AI's custom
 * instructions field). Same two loops, no reasoning.
 */
export const MEMORY_CONTRACT_QUICK = `You are connected to Sepia, the user's memory server, over MCP. Use it on almost
every turn.

Once per session: call wake (retry up to 3x — the host sleeps), then
manage_memory action="briefing" for the user's standing rules. Treat them as
binding. Before anything slow, metered, destructive or expensive, repeat the
briefing with detail="all".

Scope to the project: call manage_namespace action="ensure" name="<repo-slug>" once,
then pass namespace="<repo-slug>" on every read and write. "personal" is the
cross-project bucket and the only namespace on the free plan. A plan_limit error
means continue in "personal" — do not retry.

Every turn: search with 2-5 keywords before you answer; persist durable facts,
decisions and corrections in the same turn, after searching for an existing
memory to update. Tag a rule "always" only when it applies in every repo and every
session.

"Save to memory" means Sepia, not the editor's built-in memory. Never call
prune_memories unless the user asks to prune — it deletes.
`;


/**
 * Version of the agent-facing docs. Bump, then run `scripts/stamp-docs-version.ts` — it
 * writes every marker declared in `scripts/docs-manifest.ts`. Served at /version so
 * installed copies can be checked. This is the ONLY version concept: the `version:`
 * frontmatter key is not a separate "skill version", and treating it as one froze three
 * files at 1.0.0 while every other marker advanced.
 */
export const DOCS_VERSION = "1.16.1";

/** The four memory types. */
export const MEMORY_TYPES = [
  "fact",
  "observation",
  "preference",
  "instruction",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** The five canonical entity types. */
export const ENTITY_TYPES = [
  "person",
  "project",
  "tool",
  "concept",
  "repo",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * Canonical entity type, case-insensitively. Unknown becomes `concept` with the original kept as
 * a tag. No alias map on purpose — reclassification is a `batch_update`, not a hardcoded table.
 */
export function normalizeEntityType(type: string): {
  type: EntityType;
  tag?: string;
} {
  const key = type.trim().toLowerCase();
  if ((ENTITY_TYPES as readonly string[]).includes(key)) {
    return { type: key as EntityType };
  }
  return { type: "concept", tag: key };
}

/** Upper bounds for tags. */
export const MAX_TAGS = 10;
export const TAG_MAX_LENGTH = 32;

/**
 * Normalize a tag list: lowercase, trim, spaces → dashes, dedupe, cap
 * length + count. Empty/whitespace entries are dropped.
 */
export function normalizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .slice(0, TAG_MAX_LENGTH);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Importance is a 0-1 score; higher decays slower. */
export const IMPORTANCE_MIN = 0;
export const IMPORTANCE_MAX = 1;
export const DEFAULT_IMPORTANCE = 0.5;

/** Memories can link to at most this many entities. */
export const MAX_ENTITY_LINKS = 3;

/** Upper bounds for list-like operations. */
export const SEARCH_LIMIT_MAX = 25;
/** What a search returns when the caller does not ask for a page size. */
export const SEARCH_LIMIT_DEFAULT = 10;
export const QUERY_LIMIT_MAX = 50;
export const TRAVERSE_DEPTH_MAX = 3;

/**
 * CORE means carrying this tag, and only that. Importance ranks within the briefing and
 * never admits a row — the old `>= CORE_IMPORTANCE` half promoted any 0.9 row (project
 * rules included) into every session and made removal impossible without corrupting rank.
 */
export const ALWAYS_TAG = "always";
/** Rank boundary, NOT membership — only `ALWAYS_TAG` decides core. Exported for the dashboard's promote/demote step. */
export const CORE_IMPORTANCE = 0.9;
/** `coverage` is the default; `bm25` ranks the Postgres tsvector columns. Both in Postgres. */
export const SEARCH_ENGINES = ["coverage", "bm25"] as const;
export type SearchEngine = (typeof SEARCH_ENGINES)[number];

/** Memory types the briefing covers. An `always`-tagged row of any type is included too. */
export const BRIEFING_TYPES = ["instruction", "preference"] as const;
/**
 * `core` (default) is the guarantee — rules needed before any work, which search cannot find.
 * `all` adds the unbounded tail; ask explicitly before anything slow, metered or destructive.
 * Core is stable and the tail is not, so loading the tail by default degrades over time.
 */
export const BRIEFING_DETAILS = ["core", "all"] as const;
export type BriefingDetail = (typeof BRIEFING_DETAILS)[number];
export const BRIEFING_DETAIL_DEFAULT: BriefingDetail = "core";
/** Per-item compaction. Full text stays reachable via `manage_memory action=get` on the id. */
export const BRIEFING_ITEM_CHARS = 400;
/**
 * Default total character budget. Only applies to `detail: "all"` — core rules are never
 * dropped for budget, so the core briefing ignores it entirely.
 */
export const BRIEFING_CHARS_DEFAULT = 8000;
/** Hard cap on rows fetched while budgeting, so `omitted` stays bounded work. */
export const BRIEFING_FETCH_MAX = 500;
/** `FETCH_MAX * ITEM_CHARS` — the most a briefing can physically return, so `all` at max is everything. */
export const BRIEFING_CHARS_MAX = BRIEFING_FETCH_MAX * BRIEFING_ITEM_CHARS;

/** Consolidation policy (days). */
export const STALE_AFTER_DAYS = 90; // importance < 0.3 and untouched for this long → archive
export const STALE_IMPORTANCE = 0.3;
export const PURGE_AFTER_DAYS = 30; // archived for this long → hard delete
