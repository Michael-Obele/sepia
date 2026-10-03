import { query } from '$app/server';
import {
	buildStats,
	getPlanLimits,
	namespacesQuery,
	statsQueries,
	type NamespaceStats,
	type PlanLimits,
	type Stats
} from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

export interface HomePage {
	stats: Stats;
	namespaces: NamespaceStats[];
	/**
	 * The plan's limits, resolved SERVER-side on purpose.
	 *
	 * This must NOT be recomputed in the page. Doing so means VALUE-importing the
	 * `@sepia/shared` barrel from a `.svelte` file, and that barrel re-exports
	 * `db/lib/telemetry.ts`, which has a top-level `node:crypto` import. Vite then
	 * externalizes it for the browser ("Cannot access node:crypto.createHash in
	 * client code") and the page's CLIENT bundle throws at import time — the page
	 * renders its heading and nothing else. Type-only imports from the barrel are
	 * erased and safe; a single value import is not.
	 */
	limits: PlanLimits;
}

/**
 * Everything `/app` renders on its first paint, in ONE Neon HTTP round trip:
 * the 11 dashboard-stat statements plus the namespace filter options.
 *
 * `getMe` is deliberately NOT part of this. The plan-limit nudge needs a memory
 * COUNT and the plan's limit: the count is already in `stats`, and the limit is
 * a pure constant (`getPlanLimits`), so `getUsage` — which itself ran three
 * counts through `Promise.all` — was an entire round trip for nothing.
 *
 * The array is passed INLINE to `db.batch`, and the namespace query goes FIRST
 * so the stat results are the rest of the tuple and can be handed straight to
 * `buildStats`. Measured: 258 ms for the whole page vs 1308 ms for the three
 * calls it replaces.
 */
export const getHomePage = query(async (): Promise<HomePage> => {
	const user = await requireAuth();
	const sql = db();
	const [namespaces, ...statsResults] = await sql.batch([
		namespacesQuery(sql, user.id),
		...statsQueries(sql, user.id)
	]);
	return {
		stats: buildStats(statsResults),
		namespaces: namespaces.rows as unknown as NamespaceStats[],
		limits: getPlanLimits(user.plan)
	};
});
