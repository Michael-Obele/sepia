import { form } from '$app/server';
import * as v from 'valibot';
import { env } from '$env/dynamic/private';

/**
 * Auth remote functions. The dashboard (Netlify) talks to the Fly server's
 * Better Auth endpoints (/api/auth/*) — the remote function runs server-side
 * so the request is a plain server-to-server fetch (no CORS, no client
 * exposure of the auth URL).
 *
 * The session token returned by sign-in is stored client-side and used as a
 * bearer token by every other remote function (the bearer plugin makes
 * Better Auth session tokens work as bearer tokens).
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

export interface AuthResult {
	token: string;
	user: {
		id: string;
		name: string;
		email: string;
		plan: string;
	};
}

async function authFetch(path: string, body: unknown): Promise<AuthResult> {
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
	const token = (data as { token?: string }).token;
	const user = (data as { user?: AuthResult['user'] }).user;
	if (!token || !user) {
		throw new Error('Auth server returned an unexpected response');
	}
	return { token, user };
}

/** Sign in with email + password. Returns the session token. */
export const signIn = form(SignInSchema, async ({ email, _password }) => {
	return authFetch('sign-in/email', { email, password: _password });
});

/** Create an account. Returns the session token. */
export const signUp = form(SignUpSchema, async ({ name, email, _password }) => {
	return authFetch('sign-up/email', { name, email, password: _password });
});
