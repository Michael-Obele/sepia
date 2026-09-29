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
		allRelations(sql, user.id)
	]);
	const entities = await findEntities(sql, user.id, undefined, undefined, undefined, 10000);
	const memories = await queryMemories(sql, user.id, { archived: false, limit: 10000 });
	return { namespaces, entities, memories, relations };
});

/**
 * ALL relations for the export — pages through listRelations until a short
 * page comes back. The unfiltered branch used to cap at 200 silently, so an
 * owner with >200 relations downloaded an incomplete "full export" with no
 * signal (disposition-5 data-loss bug, docs/plans/2026-09-29-silent-arg-drop
 * -guardrails.md). 500/page, hard stop at 100k rows so a pathological page
 * loop can't run forever.
 */
async function allRelations(sql: ReturnType<typeof db>, ownerId: string) {
	const pageSize = 500;
	const maxRows = 100000;
	const rows: Awaited<ReturnType<typeof listRelations>> = [];
	for (let offset = 0; offset < maxRows; offset += pageSize) {
		const page = await listRelations(sql, ownerId, { limit: pageSize, offset });
		rows.push(...page);
		if (page.length < pageSize) return rows;
	}
	return rows;
}
