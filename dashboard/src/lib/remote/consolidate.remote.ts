import { command } from '$app/server';
import { consolidate } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/** Run the decay/dedup/purge maintenance sweep. */
export const runConsolidate = command(async () => {
	const user = await requireAuth();
	return consolidate(db(), user.id);
});
