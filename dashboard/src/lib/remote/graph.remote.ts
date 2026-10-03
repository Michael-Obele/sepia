import { query } from '$app/server';
import { traverseGraph, fullGraph, mostConnectedEntity, TraverseInput } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/**
 * The Focus view's default root — the most connected entity. Ordering by degree
 * rather than access count matters: 58% of entities have no relations, and the
 * most-accessed one is among them, so the old default rendered a single node.
 */
export const getGraphRoot = query(async () => {
	const user = await requireAuth();
	return mostConnectedEntity(db(), user.id);
});

/** BFS traversal of the knowledge graph from a start entity. */
export const getGraph = query(TraverseInput, async (input) => {
	const user = await requireAuth();
	return traverseGraph(db(), user.id, input.start_id, input.depth);
});

/** The entire knowledge graph (all entities + relations) for the full view. */
export const getFullGraph = query(async () => {
	const user = await requireAuth();
	try {
		return await fullGraph(db(), user.id);
	} catch (e) {
		console.error('[getFullGraph] error:', e);
		throw e;
	}
});
