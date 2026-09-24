import { query } from '$app/server';
import * as v from 'valibot';
import { getBriefing } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

const BriefingFilters = v.object({
	namespace: v.optional(v.string()),
	detail: v.optional(v.picklist(['core', 'all']))
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
