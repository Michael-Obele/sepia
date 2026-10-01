import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The graph is a rendering of entity nodes, filtered by entity type — a view
 * of entities, not a second place to reach them. It is now a toggle on the
 * list that owns them.
 */
export const load: PageServerLoad = () => {
	throw redirect(308, '/app/entities?view=graph');
};
