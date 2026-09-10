import { query, command } from '$app/server';
import * as v from 'valibot';
import { listRelations, createRelation, deleteRelation, RelationInput } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

const RelationFilters = v.object({
	entity_id: v.optional(v.string()),
	namespace: v.optional(v.string())
});

/** List relations (by entity or namespace). */
export const getRelations = query(RelationFilters, async (filters) => {
	const user = await requireAuth();
	return listRelations(db(), user.id, filters);
});

/** Create a relation (upserts weight on conflict). */
export const addRelation = command(RelationInput, async (input) => {
	const user = await requireAuth();
	return createRelation(db(), user.id, input);
});

/** Delete a relation. */
export const removeRelation = command(v.string(), async (id) => {
	const user = await requireAuth();
	return deleteRelation(db(), user.id, id);
});
