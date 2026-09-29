import { command } from '$app/server';
import * as v from 'valibot';
import { pruneMemories } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/**
 * Run the decay/dedup/purge maintenance sweep.
 *
 * DISPOSITION 10 (safety-gate parity): `confirm: true` is mandatory — the
 * MCP schema always required it; REST and this dashboard remote did not, so
 * three surfaces disagreed about whether a destructive sweep needs an
 * explicit yes. The UI passes it only from the ConfirmDeleteDialog path.
 */
export const runPruneMemories = command(
	v.object({ confirm: v.literal(true) }),
	async ({ confirm }) => {
		if (confirm !== true) throw new Error('confirm: true required');
		const user = await requireAuth();
		return pruneMemories(db(), user.id);
	}
);
