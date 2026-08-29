import { query, command } from '$app/server';
import * as v from 'valibot';
import { listNamespaces, createNamespace, deleteNamespace, NamespaceInput } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/** List namespaces with entity/memory/relation counts. */
export const getNamespaces = query(v.string(), async (token) => {
	const user = await requireAuth(token);
	return listNamespaces(db(), user.id);
});

/** Create a namespace. */
export const addNamespace = command(
	v.tuple([v.string(), NamespaceInput]),
	async ([token, input]) => {
		const user = await requireAuth(token);
		return createNamespace(db(), user.id, input.name, input.description, user.plan);
	}
);

/** Delete a namespace (cascades entities → relations/memories). */
export const removeNamespace = command(
	v.tuple([v.string(), v.string()]),
	async ([token, idOrName]) => {
		const user = await requireAuth(token);
		return deleteNamespace(db(), user.id, idOrName);
	}
);
