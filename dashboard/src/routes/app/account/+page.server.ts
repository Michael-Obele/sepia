import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * `/app/account` was folded into Settings (identity + sessions → Profile,
 * plan + usage → Plan & usage, keys + connections → Connect).
 *
 * 308 so the method and the intent are preserved — this is a permanent move,
 * not a temporary bounce. Bookmarks and any inbound link keep working.
 *
 * The `checkout` param is forwarded rather than dropped: Lemon Squeezy
 * builds this exact URL as its post-checkout `redirect_url` for checkouts
 * that are already in flight, and a fixed-path 308 would discard it — taking
 * the "payment confirmed" verification with it.
 */
export const load: PageServerLoad = ({ url }) => {
	if (url.searchParams.get('checkout') === 'success') {
		throw redirect(308, '/app/settings/plan?checkout=success');
	}
	throw redirect(308, '/app/settings');
};
