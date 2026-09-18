import { command } from '$app/server';
import { pruneMemories } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/** Run the decay/dedup/purge maintenance sweep. */
export const runPruneMemories = command(async () => {
	const user = await requireAuth();
	return pruneMemories(db(), user.id);
});
