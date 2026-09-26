import { command, form, query } from '$app/server';
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
import { parseTags } from './parsers';

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

/**
 * Create or update an entity, as a form — the dialog's Save button is a
 * submit button, so saving works without JavaScript. `id` present → update
 * (the namespace is then irrelevant, exactly as with the old two commands).
 *
 * UI-shaped schema (tags arrive as comma-separated text); `v.parse` re-applies
 * the shared schema so tag caps and the 200-char name bound stay guaranteed.
 */
export const saveEntity = form(
	v.object({
		id: v.optional(v.string(), ''),
		namespace: v.optional(v.string(), 'personal'),
		name: v.pipe(v.string(), v.minLength(1, 'Name is required'), v.maxLength(200)),
		type: v.pipe(v.string(), v.minLength(1, 'Type is required'), v.maxLength(64)),
		summary: v.optional(v.string(), ''),
		importance: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1)), 0.5),
		tags: v.optional(v.string(), '')
	}),
	async ({ id, namespace, name, type, summary, importance, tags }) => {
		const user = await requireAuth();
		const fields = { name, type, summary, importance, tags: parseTags(tags) };
		if (id) {
			return updateEntity(db(), user.id, id, v.parse(EntityUpdateInput, fields));
		}
		return createEntity(db(), user.id, namespace, v.parse(EntityInput, fields));
	}
);

/** Delete an entity (cascades relations, unlinks memories). */
export const removeEntity = command(v.string(), async (id) => {
	const user = await requireAuth();
	return deleteEntity(db(), user.id, id);
});
