import { query, command } from '$app/server';
import * as v from 'valibot';
import { env } from '$env/dynamic/private';

/**
 * API key management remote functions. The dashboard talks to the Fly
 * server's Better Auth apiKey plugin endpoints (/api/auth/api-key/*) — the
 * remote function runs server-side so the request is a plain server-to-server
 * fetch (no CORS, no client exposure of the auth URL).
 *
 * The session token is sent as a Bearer header — the bearer plugin makes
 * Better Auth session tokens work as bearer tokens, so no session cookie is
 * needed in the browser (sign-in is server-side via auth.remote.ts).
 */

const AUTH_URL = () => env.AUTH_URL ?? 'https://sepia.fly.dev';

async function authFetch(path: string, token: string, init?: RequestInit) {
	const res = await fetch(`${AUTH_URL()}/api/auth/${path}`, {
		...init,
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
			// Better Auth's CSRF/origin check rejects requests without an
			// Origin header — this is a server-to-server call, so set it to
			// the auth server's own origin.
			origin: AUTH_URL(),
			...(init?.headers ?? {})
		}
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const message =
			(data as { message?: string }).message ??
			(data as { code?: string }).code ??
			`API key request failed (${res.status})`;
		throw new Error(message);
	}
	return data;
}

export interface ApiKeyRow {
	id: string;
	name: string;
	createdAt: string;
	lastRequest: string | null;
}

/** List the current user's API keys. */
export const listApiKeys = query(v.string(), async (token): Promise<ApiKeyRow[]> => {
	const data = (await authFetch('api-key/list', token, { method: 'GET' })) as {
		apiKeys?: Array<{
			id: string;
			name?: string | null;
			createdAt: string | Date;
			lastRequest?: string | Date | null;
		}>;
	};
	return (data.apiKeys ?? []).map((k) => ({
		id: k.id,
		name: k.name ?? 'Untitled key',
		createdAt: String(k.createdAt),
		lastRequest: k.lastRequest ? String(k.lastRequest) : null
	}));
});

/** Create an API key. Returns the plaintext key (shown only once). */
export const createApiKey = command(
	v.string(),
	async (token): Promise<{ id: string; key: string }> => {
		const data = (await authFetch('api-key/create', token, {
			method: 'POST',
			body: JSON.stringify({ name: `sepia-${new Date().toISOString().slice(0, 10)}` })
		})) as { id?: string; key?: string };
		if (!data.id || !data.key) {
			throw new Error('API key create returned an unexpected response');
		}
		return { id: data.id, key: data.key };
	}
);

/** Delete an API key. */
export const deleteApiKey = command(v.tuple([v.string(), v.string()]), async ([token, keyId]) => {
	await authFetch('api-key/delete', token, {
		method: 'POST',
		body: JSON.stringify({ keyId })
	});
});
