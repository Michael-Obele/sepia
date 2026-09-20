/**
 * The SERVER barrel. Everything reachable from here — `db/client.ts`, the
 * Drizzle schema, `db/lib/*` — assumes Postgres and Node builtins, so none of
 * it belongs in a browser bundle.
 *
 * Browser code (dashboard components) must import from `@sepia/shared/types`
 * instead. That subpath resolves to `types.ts`, which imports nothing at all,
 * so it is safe client-side.
 *
 * Getting this wrong is quiet: importing the barrel from a `.svelte` file
 * ships the whole database layer to the browser and then throws at runtime the
 * first time a re-exported module touches a Node builtin — `node:crypto` in
 * `db/lib/telemetry.ts` is how this was found. `browser-safety.test.ts` guards
 * the rule.
 */
export * from "./types.ts";
export * from "./schemas.ts";
export * from "./db/schema.ts";
export * from "./db/errors.ts";
export * from "./db/client.ts";
export * from "./db/lib/util.ts";
export * from "./db/lib/entities.ts";
export * from "./db/lib/memories.ts";
export * from "./db/lib/relations.ts";
export * from "./db/lib/conversations.ts";
export * from "./db/lib/namespaces.ts";
export * from "./db/lib/search.ts";
export * from "./db/lib/graph.ts";
export * from "./db/lib/prune.ts";
export * from "./db/lib/stats.ts";
export * from "./db/lib/telemetry.ts";
export * from "./db/lib/plans.ts";
export * from "./db/lib/users.ts";
export * from "./db/lib/oauth-clients.ts";
