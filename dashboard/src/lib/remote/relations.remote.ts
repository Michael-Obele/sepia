import { command, form, query } from '$app/server';
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

/**
 * Create a relation (upserts weight on conflict) as a form — the page's
 * "Add relation" button is a submit button, so it works without JavaScript.
 * `direction` swaps which end is this entity, exactly what the page used to
 * do client-side; `v.parse` keeps the shared schema's uuid/weight validation.
 */
export const addRelation = form(
	v.object({
		source_id: v.pipe(v.string(), v.minLength(1)),
		target_id: v.pipe(v.string(), v.minLength(1, 'Choose a target entity')),
		direction: v.picklist(['out', 'in']),
		relation_type: v.pipe(v.string(), v.minLength(1, 'Relation type is required'), v.maxLength(64)),
		weight: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1)), 0.5)
	}),
	async ({ source_id, target_id, direction, relation_type, weight }) => {
		const user = await requireAuth();
		const input =
			direction === 'out'
				? { source_id, target_id, relation_type, weight }
				: { source_id: target_id, target_id: source_id, relation_type, weight };
		return createRelation(db(), user.id, v.parse(RelationInput, input));
	}
);

/** Delete a relation. */
export const removeRelation = command(v.string(), async (id) => {
	const user = await requireAuth();
	return deleteRelation(db(), user.id, id);
});
