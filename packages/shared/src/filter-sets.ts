/**
 * The single source of truth for filter parity (G3). A filter can die silently at five
 * layers — schema, parse, handler, surface, docs — which is exactly what happened on
 * 2026-09-29 when `q` was missing from the MCP schema. Tests anchor to these sets, never
 * to schema keys, so a forgotten param is the thing that fails.
 * Contract: declared on the schema, forwarded by every surface, named in agent docs.
 */

/** manage_memory action=query — every filter queryMemories honors. */
export const MEMORY_QUERY_FILTERS = [
  "type",
  "namespace",
  "importance_min",
  "archived",
  "tags",
  "q",
  "offset",
  "limit",
] as const;

/** manage_entity find — every filter findEntities honors (positional today). */
export const ENTITY_FIND_FILTERS = [
  "query",
  "type",
  "namespace",
  "limit",
  "offset",
] as const;

/** search — every filter search() honors. */
export const SEARCH_FILTERS = [
  "q",
  "namespace",
  "type",
  "tags",
  "limit",
  "min_terms",
  "engine",
] as const;

/**
 * manage_relation list — every filter listRelations honors. `limit`/`offset`
 * landed with the item-5 export fix (all three branches capped, paging).
 */
export const RELATION_LIST_FILTERS = [
  "entity_id",
  "namespace",
  "limit",
  "offset",
] as const;

/**
 * Per-surface keys that are deliberately NOT wired, with the reason.
 * An unwired key with no entry here is a parity failure.
 */
export const FILTER_OMITTED: Record<
  string,
  { surface: string; reason: string }
> = {
  // Dashboard browsing shows every namespace; MCP scoping to the caller's
  // default is intentional (namespace default divergence, audit item 11).
  "dashboard.namespace-default": {
    surface: "dashboard getMemories",
    reason: "browse view lists all namespaces unless one is picked",
  },
  // REST has no offset on GET /api/memories? — it does now (G1). Keep this
  // object for future omissions; an empty omission list is the goal.
};

/**
 * G5 — self-describing responses, KEYED BY THE DECLARED SET rather than by what the handler
 * passed: a stripped key never reaches the handler, so echoing its view would inherit the very
 * bug this defeats. Every declared filter appears (or null), so `filters_applied: { q: null }`
 * proves a keyword was not applied. `ignored` covers the wrong-action class, and a key equal to
 * its schema default counts as not-sent (valibot fills defaults in).
 */
export function echoQueryFilters(
  args: Record<string, unknown>,
  declared: readonly string[],
  // valibot entry values are a heterogeneous union — read `.default` duck-typed.
  entries?: Record<string, unknown>,
): {
  filters_applied: Record<string, unknown>;
  ignored: string[];
} {
  const declaredSet = new Set(declared);
  const filters_applied: Record<string, unknown> = {};
  for (const key of declared) filters_applied[key] = args[key] ?? null;
  const ignored = Object.keys(args)
    .filter((k) => {
      if (k === "action" || declaredSet.has(k)) return false;
      const entry = entries?.[k] as { default?: unknown } | undefined;
      // Schema-filled default = caller never sent it → not a real param.
      if (entry && "default" in entry && args[k] === entry.default)
        return false;
      return true;
    })
    .map((k) =>
      // `entries` doubles as the schema's declared-key set: present → declared
      // but belonging to another action; absent → not a parameter at all.
      entries && k in entries
        ? `${k} (not valid for this action — ignored)`
        : `${k} (unknown parameter — never applied)`,
    );
  return { filters_applied, ignored };
}
