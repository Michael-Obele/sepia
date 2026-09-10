import { query } from '$app/server';
import { getStats } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/** Dashboard stats: counts, top entities, decay candidates, recent feed. */
export const getStatsData = query(async () => {
	const user = await requireAuth();
	return getStats(db(), user.id);
});
