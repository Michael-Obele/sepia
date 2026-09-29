/**
 * Declared filter sets — the single source of truth for surface parity (G3).
 *
 * WHY THIS EXISTS (2026-09-29 silent-arg-drop, docs/plans/2026-09-29-silent-
 * arg-drop-guardrails.md): a filter can die at five layers (schema → parse →
 * handler → surface → docs), and every layer used to be silent. The incident
 * was `q` missing from the MCP schema while the lib supported it — plus
 * REST/stdio dropping it for the same reason. `search.test.ts`-style tests
 * anchor to these sets (not to schema keys): a param the schema forgot is
 * exactly what must fail the test, so schema-anchored iteration would be
 * blind to the original bug.
 *
 * CONTRACT: every key here must be (1) declared on the tool schema, (2)
 * forwarded by every handler/REST branch/stdio client that claims to support
 * it, (3) named in agent-facing docs. scripts/filter-parity.test.ts asserts
 * (1) DB-free; src/tools/memory.test.ts asserts (2) behaviorally through the
 * real tmcp validation path. Adding a filter to a lib function without adding
 * it here (or to an OMITTED list with a reason) is the drift this catches.
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
 * G5 — self-describing responses.
 *
 * KEYED BY THE DECLARED SET, never by "spread what the handler passed": a
 * stripped key never reaches the handler, so echoing the handler's own view
 * would inherit the exact bug this exists to defeat (forge-logic). Every
 * declared filter appears with its value (or null), so an agent can see
 * `filters_applied: { q: null }` and know its keyword was NOT applied —
 * the signal the 2026-09-29 report never had.
 *
 * `ignored` covers present-but-inapplicable params — the wrong-action class
 * (`where` on action=query passes every schema check and dies silently;
 * forge-logic: survives G1–G4). `entries` is the schema's entry map: valibot
 * FILLS DEFAULTS into parsed output (`detail: "core"` appears without the
 * caller sending it), so a key whose value equals its schema default is
 * treated as not-sent and never reported. A caller who explicitly sends the
 * default value is indistinguishable — accepting that, since the value is
 * then identical to doing nothing.
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
