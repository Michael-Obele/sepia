/**
 * Constants shared by the server, the dashboard, and the skill reference
 * generator. Single source of truth for domain values.
 */

/** Default namespace for all tools when none is specified. */
export const DEFAULT_NAMESPACE = "personal";

/**
 * Version of the agent-facing docs (contract, SKILL.md, always-on files,
 * llms.txt). Bump when any of them change, then run
 * `bun run scripts/stamp-docs-version.ts` to stamp it into every file.
 * Served at /version so installed copies can be checked for staleness.
 */
export const DOCS_VERSION = "1.0.0";

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
 * Normalize a free-form entity type to a canonical one. Case-insensitive
 * match against the canonical list; anything unknown becomes `concept` with
 * the original value preserved as a tag so no information is lost.
 *
 * Deliberately NO alias map — semantic reclassification (e.g. "project-migration"
 * → project) is done via `manage_entity` action=batch_update, not hardcoded here.
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
export const QUERY_LIMIT_MAX = 50;
export const TRAVERSE_DEPTH_MAX = 3;

/** Consolidation policy (days). */
export const STALE_AFTER_DAYS = 90; // importance < 0.3 and untouched for this long → archive
export const STALE_IMPORTANCE = 0.3;
export const PURGE_AFTER_DAYS = 30; // archived for this long → hard delete
