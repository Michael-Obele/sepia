import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Telemetry became a rarely-changed preference: Settings → Preferences. */
export const load: PageServerLoad = () => {
	throw redirect(308, '/app/settings/preferences');
};
