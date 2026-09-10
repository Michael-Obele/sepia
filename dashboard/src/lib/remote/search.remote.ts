import { query } from '$app/server';
import { search, SearchInput } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/** Unified search over memories + entities (same engine as the MCP tool). */
export const searchAll = query(SearchInput, async (input) => {
	const user = await requireAuth();
	return search(db(), user.id, input);
});
