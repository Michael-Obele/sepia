import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Briefing was always a view of memories, not its own dataset — it is the
 * `instruction`/`preference` rows an AI reads at session start. It is now a
 * tab on the list that owns them, so the redirect lands on that tab rather
 * than on the default `all` view.
 */
export const load: PageServerLoad = () => {
	throw redirect(308, '/app/memories?view=briefing');
};
