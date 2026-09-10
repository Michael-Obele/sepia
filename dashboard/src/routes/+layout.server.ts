import { getSessionUser } from '$lib/server/auth';
import type { LayoutServerLoad } from './$types';

/**
 * The app's single source of auth truth. Resolved on the server from the
 * HTTP-only session cookie, so SSR renders the correct signed-in/out state
 * (no client-side flash) and every page gets `data.user`.
 */
export const load: LayoutServerLoad = async () => {
	// Anonymous visitors short-circuit: no cookie means no DB round-trip.
	return { user: await getSessionUser() };
};
