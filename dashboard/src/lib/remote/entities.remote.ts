import { query, command } from '$app/server';
import * as v from 'valibot';
import {
	findEntities,
	getEntity,
	createEntity,
	updateEntity,
	deleteEntity,
	EntityInput,
	EntityUpdateInput
} from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

const EntityFilters = v.object({
	namespace: v.optional(v.string()),
	q: v.optional(v.string()),
	type: v.optional(v.string()),
	limit: v.optional(v.number(), 20),
	offset: v.optional(v.number(), 0)
});

/** List/filter entities. */
export const getEntities = query(EntityFilters, async (filters) => {
	const user = await requireAuth();
	return findEntities(
		db(),
		user.id,
		filters.namespace,
		filters.q,
		filters.type,
		filters.limit,
		filters.offset
	);
});

/** Full entity detail: entity + linked memories + in/out relations. */
export const getEntityDetail = query(v.string(), async (id) => {
	const user = await requireAuth();
	return getEntity(db(), user.id, id);
});

/** Create an entity. */
export const addEntity = command(v.tuple([v.string(), EntityInput]), async ([namespace, input]) => {
	const user = await requireAuth();
	return createEntity(db(), user.id, namespace, input);
});

/** Update an entity. */
export const updateEntityData = command(
	v.tuple([v.string(), EntityUpdateInput]),
	async ([id, update]) => {
		const user = await requireAuth();
		return updateEntity(db(), user.id, id, update);
	}
);

/** Delete an entity (cascades relations, unlinks memories). */
export const removeEntity = command(v.string(), async (id) => {
	const user = await requireAuth();
	return deleteEntity(db(), user.id, id);
});
