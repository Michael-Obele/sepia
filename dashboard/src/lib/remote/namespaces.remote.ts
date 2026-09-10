import { query, command } from '$app/server';
import * as v from 'valibot';
import { listNamespaces, createNamespace, deleteNamespace, NamespaceInput } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/** List namespaces with entity/memory/relation counts. */
export const getNamespaces = query(async () => {
	const user = await requireAuth();
	return listNamespaces(db(), user.id);
});

/** Create a namespace. */
export const addNamespace = command(NamespaceInput, async (input) => {
	const user = await requireAuth();
	return createNamespace(db(), user.id, input.name, input.description, user.plan);
});

/** Delete a namespace (cascades entities → relations/memories). */
export const removeNamespace = command(v.string(), async (idOrName) => {
	const user = await requireAuth();
	return deleteNamespace(db(), user.id, idOrName);
});
