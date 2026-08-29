import { query } from '$app/server';
import * as v from 'valibot';
import { getUsage, type UserRow } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

export interface MeResult {
	user: {
		id: string;
		email: string;
		name: string;
		plan: string;
		created_at: string;
	};
	usage: Awaited<ReturnType<typeof getUsage>>;
}

/** Current account + usage (plan limits for the nudge). */
export const getMe = query(v.string(), async (token): Promise<MeResult> => {
	const user = await requireAuth(token);
	return {
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
			plan: user.plan,
			created_at: String(user.createdAt)
		},
		usage: await getUsage(db(), user.id, user.plan)
	};
});

export type { UserRow };
