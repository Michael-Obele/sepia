import { command, form, query } from '$app/server';
import * as v from 'valibot';
import { listNamespaces, createNamespace, deleteNamespace } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/** List namespaces with entity/memory/relation counts. */
export const getNamespaces = query(async () => {
	const user = await requireAuth();
	return listNamespaces(db(), user.id);
});

/** Create a namespace. A form (not a command): the Create button is a submit
 * button, so creating still works without JavaScript. */
export const addNamespace = form(
	v.object({
		name: v.pipe(v.string(), v.minLength(1, 'Namespace name is required'), v.maxLength(64)),
		description: v.optional(v.string(), '')
	}),
	async ({ name, description }) => {
		const user = await requireAuth();
		return createNamespace(db(), user.id, name, description, user.plan);
	}
);

/** Delete a namespace (cascades entities → relations/memories). */
export const removeNamespace = command(v.string(), async (idOrName) => {
	const user = await requireAuth();
	return deleteNamespace(db(), user.id, idOrName);
});
