import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import {
	getSessionWithUser,
	getUserByApiKey,
	getUserByEmail,
	slideSession,
	type UserRow
} from '@sepia/shared';
import { db } from '$lib/server/db';
import {
	readSessionToken,
	SESSION_MAX_LIFETIME_MS,
	SESSION_REFRESH_INTERVAL_MS,
	SESSION_TTL_MS
} from '$lib/server/cookies';

/** The shape returned by `getSessionWithUser` — a session row plus its owner. */
type SessionWithUser = NonNullable<Awaited<ReturnType<typeof getSessionWithUser>>>;

/**
 * How long a resolved token is reused WITHOUT touching the database.
 *
 * Sessions are instantly revocable by design ("the DB row is the authority"),
 * so this is a deliberate, BOUNDED trade: a token revoked from another device
 * can still read for up to this long. It buys a lot — one navigation used to
 * run the `sessions ⋈ users` lookup three times, and each lookup is a full Neon
 * HTTP round trip (~300 ms measured 2026-10-02). `signOut` clears the entry, so
 * the window only ever covers revocation from elsewhere.
 */
const SESSION_CACHE_TTL_MS = 30_000;

/** token → resolved user (or null), with a hard expiry. */
const sessionCache = new Map<string, { user: UserRow | null; expiresAt: number }>();

/**
 * Server-side auth for remote functions and loads. The session token lives in
 * an HTTP-only first-party cookie written at sign-in (see `cookies.ts`), and is
 * resolved against the Neon `sessions` table — no call to the auth server and
 * no cookie of its own.
 *
 * Sessions slide: an active user's expiry is pushed forward on the way through
 * (see `renewSessionIfStale`), capped at an absolute lifetime.
 *
 * Resolution is memoised twice — once per request (`locals.user`, so a page's
 * own queries reuse what the root layout already looked up) and once per token
 * with a short TTL (so a click-through on a warm instance doesn't re-read the
 * session for every remote call). One navigation used to run this lookup three
 * times, at ~300 ms each.
 *
 * Legacy fallback: the server's MCP_BEARER_TOKEN still works (self-host
 * compat) and resolves to the admin user.
 */
export async function getSessionUser(): Promise<UserRow | null> {
	const token = readSessionToken();
	if (!token) return null;

	// 1. PER-REQUEST MEMO. The root +layout.server.ts has usually resolved this
	//    already, and a remote query called during SSR runs in the SAME request
	//    store (kit's runtime/app/server/remote/query.js goes through
	//    get_request_store()/run_remote_function, no HTTP hop), so the page's own
	//    query reuses the user for free instead of joining sessions⋈users again.
	const locals = getRequestEvent().locals;
	if (locals.user !== undefined) return locals.user;

	// 2. CROSS-REQUEST CACHE for client-initiated remote calls, which arrive as
	//    fresh serverless invocations. A warm Netlify instance serves a whole
	//    click-through without re-reading the session.
	const cached = sessionCache.get(token);
	if (cached && cached.expiresAt > Date.now()) {
		locals.user = cached.user;
		return cached.user;
	}

	const user = await lookupSessionUser(token);
	locals.user = user;
	sessionCache.set(token, { user, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
	return user;
}

/**
 * Drop a token from the cross-request cache. `signOut` calls this so a sign-out
 * on THIS instance revokes immediately; the TTL only ever covers revocation
 * from elsewhere (another device / another warm instance).
 */
export function forgetSession(token: string | null): void {
	if (token) sessionCache.delete(token);
}

/**
 * The actual database work behind `getSessionUser`: legacy global token, then
 * the session row, then a Better Auth API key. Kept separate so the caching
 * above stays readable.
 */
async function lookupSessionUser(token: string): Promise<UserRow | null> {
	// Use the dashboard's db() wrapper — it passes DATABASE_URL from
	// $env/dynamic/private (the shared db() falls back to process.env,
	// which Vite's SSR process doesn't populate).
	const sql = db();

	// Legacy global token → admin (self-host setups without accounts).
	if (env.MCP_BEARER_TOKEN && token === env.MCP_BEARER_TOKEN) {
		const admin = env.ADMIN_EMAIL ? await getUserByEmail(sql, env.ADMIN_EMAIL) : undefined;
		return admin ?? null;
	}

	// Wrap the DB lookups so a transient Neon failure doesn't surface as a 500 —
	// it should be a 401 with a retryable message (remote functions surface
	// 500s as "Failed query").
	try {
		const found = await getSessionWithUser(sql, token);
		if (found) {
			await renewSessionIfStale(sql, token, found.session);
			return found.user;
		}

		// Better Auth API key (an editor key presented to the dashboard).
		const keyUser = await getUserByApiKey(sql, token);
		if (keyUser) return keyUser;
	} catch (e) {
		console.error('[auth] token lookup failed', e);
		error(401, 'Session lookup failed — please sign in again');
	}

	return null;
}

/**
 * Push an active session's expiry forward so daily users aren't logged out
 * weekly.
 *
 * Better Auth normally does this via its own `session.updateAge` (1 day) inside
 * `get-session`, but that path never runs here: the dashboard reads the
 * `sessions` table directly instead of calling `auth.api.getSession`. So the
 * sliding window is ours to implement.
 *
 * Two guards keep the cost at roughly one write per session per day:
 * - only slide once the stored expiry is older than the refresh interval;
 * - never slide past `createdAt + SESSION_MAX_LIFETIME_MS`.
 */
async function renewSessionIfStale(
	sql: ReturnType<typeof db>,
	token: string,
	session: SessionWithUser['session']
): Promise<void> {
	const remaining = session.expiresAt.getTime() - Date.now();
	if (remaining > SESSION_TTL_MS - SESSION_REFRESH_INTERVAL_MS) return;

	// `sessions.token` holds the bare sessionId, not the signed token.
	const sessionId = token.split('.')[0] ?? token;
	await slideSession(sql, sessionId, session.createdAt, SESSION_TTL_MS, SESSION_MAX_LIFETIME_MS);
}

/** Resolve the signed-in user or fail the request with a 401. */
export async function requireAuth(): Promise<UserRow> {
	const user = await getSessionUser();
	if (!user) error(401, 'Unauthorized — sign in with your sepia account');
	return user;
}
