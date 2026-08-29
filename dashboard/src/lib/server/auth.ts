import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	getUserByApiKey,
	getUserByEmail,
	getUserBySessionToken,
	type UserRow
} from '@sepia/shared';
import { db } from '$lib/server/db';

/**
 * Server-side auth for remote functions. The dashboard connects to Neon
 * directly (via @sepia/shared), so the sign-in token gates the Netlify
 * function endpoints. The token is a Better Auth session token (bearer
 * plugin) or an API key — both resolve to a user, which scopes every query.
 *
 * Legacy fallback: the server's MCP_BEARER_TOKEN still works (self-host
 * compat) and resolves to the admin user.
 */
export async function requireAuth(token: string | undefined): Promise<UserRow> {
	if (!token) error(401, 'Unauthorized — sign in with your sepia account');

	// Use the dashboard's db() wrapper — it passes DATABASE_URL from
	// $env/dynamic/private (the shared db() falls back to process.env,
	// which Vite's SSR process doesn't populate).
	const sql = db();

	// Legacy global token → admin (self-host setups without accounts).
	if (env.MCP_BEARER_TOKEN && token === env.MCP_BEARER_TOKEN) {
		const admin = env.ADMIN_EMAIL ? await getUserByEmail(sql, env.ADMIN_EMAIL) : undefined;
		if (admin) return admin;
	}

	// Better Auth session token (bearer plugin).
	const sessionUser = await getUserBySessionToken(sql, token);
	if (sessionUser) return sessionUser;

	// Better Auth API key.
	const keyUser = await getUserByApiKey(sql, token);
	if (keyUser) return keyUser;

	error(401, 'Unauthorized — sign in with your sepia account');
}
