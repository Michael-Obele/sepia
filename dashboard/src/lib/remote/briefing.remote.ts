import { query } from '$app/server';
import * as v from 'valibot';
import {
	briefingQueries,
	buildBriefing,
	getBriefing,
	namespacesQuery,
	type NamespaceStats
} from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

const BriefingFilters = v.object({
	namespace: v.optional(v.string()),
	detail: v.optional(v.picklist(['core', 'all'])),
	/** false = the whole tail with no character budget (the page's "Show all" action). */
	budget: v.optional(v.boolean())
});

/**
 * The standing-rules briefing — the exact rows the AI loads at session start.
 * Wraps the same `getBriefing()` the MCP `briefing` action calls, so this page
 * and the AI always agree on what the briefing is.
 */
export const getBriefingData = query(BriefingFilters, async (filters) => {
	const user = await requireAuth();
	return getBriefing(db(), user.id, filters);
});

/**
 * Everything `/app/briefing` needs for its first paint, in ONE Neon HTTP round
 * trip: the briefing plus the namespace filter options.
 *
 * Deliberately uses `briefingQueries` — the dashboard's SUBQUERY-namespace
 * variant — rather than `getBriefing`: a stale namespace in the URL should give
 * an empty briefing, not a thrown error. `getBriefing` keeps the throwing path
 * for the MCP `briefing` action. See the note on `briefingQueries`.
 */
export const getBriefingPage = query(BriefingFilters, async (filters) => {
	const user = await requireAuth();
	const sql = db();
	const opts = { namespace: filters.namespace, detail: 'all' as const };
	const [totals, rows, namespaces] = await sql.batch([
		...briefingQueries(sql, user.id, opts),
		namespacesQuery(sql, user.id)
	]);
	return {
		briefing: buildBriefing(totals, rows, opts),
		namespaces: namespaces.rows as unknown as NamespaceStats[]
	};
});
