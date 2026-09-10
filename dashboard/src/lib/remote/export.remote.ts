import { query } from '$app/server';
import { listNamespaces, listRelations, queryMemories, findEntities } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/**
 * Full data export: all namespaces, entities, memories, and relations.
 * Used by the Settings page for JSON/Markdown download.
 */
export const exportAll = query(async () => {
	const user = await requireAuth();
	const sql = db();
	const [namespaces, relations] = await Promise.all([
		listNamespaces(sql, user.id),
		listRelations(sql, user.id)
	]);
	const entities = await findEntities(sql, user.id, undefined, undefined, undefined, 10000);
	const memories = await queryMemories(sql, user.id, { archived: false, limit: 10000 });
	return { namespaces, entities, memories, relations };
});
