import { command, form } from '$app/server';
import * as v from 'valibot';
import { env } from '$env/dynamic/private';
import { deleteOtherSessions, deleteSessionByToken } from '@sepia/shared';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { clearSessionToken, readSessionToken, writeSessionToken } from '$lib/server/cookies';

/**
 * Auth remote functions. The dashboard (Netlify) talks to the Fly server's
 * Better Auth endpoints (/api/auth/*) — the remote function runs server-side
 * so the request is a plain server-to-server fetch (no CORS, no client
 * exposure of the auth URL).
 *
 * The session token NEVER reaches the browser as a value: the bearer plugin
 * returns it in the `set-auth-token` response header, which this server-side
 * code puts straight into an HTTP-only first-party cookie (see `cookies.ts`).
 */

const AUTH_URL = () => env.AUTH_URL ?? 'https://sepia.fly.dev';

const SignInSchema = v.object({
	email: v.pipe(v.string(), v.email(), v.nonEmpty()),
	// Leading underscore: never sent back to the client on failed validation.
	_password: v.pipe(v.string(), v.minLength(1))
});

const SignUpSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
	email: v.pipe(v.string(), v.email(), v.nonEmpty()),
	// Leading underscore: never sent back to the client on failed validation.
	_password: v.pipe(v.string(), v.minLength(8))
});

/** The signed-in user shape shared by the auth remote functions. */
export interface SessionUser {
	id: string;
	name: string;
	email: string;
	plan: string;
}

function toSessionUser(user: SessionUser): SessionUser {
	return { id: user.id, name: user.name, email: user.email, plan: user.plan };
}

/**
 * Pull the session token out of Better Auth's sign-in response.
 *
 * Two sources, because the dashboard and the auth server deploy separately:
 * 1. `set-auth-token` — only present while the server still runs Better Auth's
 *    `bearer` plugin. Kept so a new dashboard works against an older server.
 * 2. The session cookie in `set-cookie` — what the current (plugin-free)
 *    server sends; the primary path.
 *
 * The cookie is named `…session_token`, carrying a `__Secure-` prefix when
 * `useSecureCookies` is on (production), so match on the suffix rather than an
 * exact name. Its value is the signed token (`{sessionId}.{signature}`).
 */
function sessionTokenFromCookie(res: Response): string | null {
	const headers = res.headers as Headers & { getSetCookie?: () => string[] };
	const combined = headers.get('set-cookie');
	const cookies = headers.getSetCookie?.() ?? (combined ? [combined] : []);

	for (const cookie of cookies) {
		// Only the `name=value` pair matters; attributes follow a `;`.
		const pair = cookie.split(';')[0] ?? '';
		const eq = pair.indexOf('=');
		if (eq === -1) continue;
		if (!pair.slice(0, eq).endsWith('session_token')) continue;
		const value = decodeURIComponent(pair.slice(eq + 1));
		return value || null;
	}
	return null;
}

async function authFetch(
	path: string,
	body: unknown
): Promise<{ token: string; user: SessionUser }> {
	const res = await fetch(`${AUTH_URL()}/api/auth/${path}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			// Better Auth's CSRF/origin check rejects requests without an
			// Origin header — this is a server-to-server call, so set it to
			// the auth server's own origin.
			origin: AUTH_URL()
		},
		body: JSON.stringify(body)
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const message =
			(data as { message?: string }).message ??
			(data as { code?: string }).code ??
			`Sign-in failed (${res.status})`;
		throw new Error(message);
	}
	const token =
		res.headers.get('set-auth-token') ??
		sessionTokenFromCookie(res) ??
		(data as { token?: string }).token;
	const user = (data as { user?: SessionUser }).user;
	if (!user) {
		throw new Error('Auth server returned an unexpected response');
	}
	if (!token) {
		// Better Auth signed us in but the token was unreadable. Usual cause:
		// the `set-auth-token` header is gone (only the `bearer` plugin emits it)
		// and the session cookie name no longer matches the `…session_token`
		// suffix this parser looks for.
		throw new Error(
			'Signed in, but no session token was found in the response ' +
				'(checked the set-auth-token header and the session cookie)'
		);
	}
	return { token, user: toSessionUser(user) };
}

/**
 * Sign in with email + password. The session token is written to an HTTP-only
 * cookie; only the user is returned to the client.
 */
export const signIn = form(SignInSchema, async ({ email, _password }) => {
	const { token, user } = await authFetch('sign-in/email', { email, password: _password });
	writeSessionToken(token);
	return { user };
});

/** Create an account. Same cookie contract as sign-in. */
export const signUp = form(SignUpSchema, async ({ name, email, _password }) => {
	const { token, user } = await authFetch('sign-up/email', { name, email, password: _password });
	writeSessionToken(token);
	return { user };
});

/**
 * Sign out — delete the session row, then clear the cookie.
 *
 * Deleting the row IS the revocation (sessions are validated by DB lookup, not
 * by the cookie's signature), and doing it here keeps sign-out independent of
 * Better Auth's `/api/auth/sign-out`: no bearer token and no extra round trip.
 * A failure must not leave the user stuck signed in locally, so the cookie is
 * cleared either way.
 */
export const signOut = command(async () => {
	const token = readSessionToken();
	if (token) {
		try {
			await deleteSessionByToken(db(), token);
		} catch (e) {
			console.warn('[signOut] session delete failed', e);
		}
	}
	clearSessionToken();
});

/**
 * Sign out of every OTHER session for this account, keeping the current one.
 *
 * The escape hatch after a token leak: revoking server-side is what makes it
 * effective, which is exactly why our sessions are DB-backed rather than
 * validated statelessly from the cookie's signature.
 */
export const signOutOtherSessions = command(async () => {
	const user = await requireAuth();
	const token = readSessionToken();
	const currentSessionId = token?.split('.')[0];
	if (!currentSessionId) {
		throw new Error('No active session to keep');
	}
	await deleteOtherSessions(db(), user.id, currentSessionId);
});
