import { query, command } from '$app/server';
import * as v from 'valibot';
import { createApiKeyForUser, deleteApiKeyForUser, listApiKeysForUser } from '@sepia/shared';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';

/**
 * API key management. The dashboard writes to the `apikey` table directly
 * through `@sepia/shared` — the same helpers the MCP server validates keys
 * with — instead of proxying Better Auth's `/api/auth/api-key/*` routes.
 *
 * That removes the last reason for a session token to leave the dashboard's
 * HTTP-only cookie: no bearer header, no CORS, and no duplicate hashing rule
 * to keep in sync.
 */

export interface ApiKeyRow {
	id: string;
	name: string;
	/** Non-secret fingerprint — `sepia_Ab3x`. Null on keys minted before prefixes. */
	start: string | null;
	createdAt: string;
	lastRequest: string | null;
}

/** List the current user's API keys (never their key material). */
export const listApiKeys = query(async (): Promise<ApiKeyRow[]> => {
	const user = await requireAuth();
	const rows = await listApiKeysForUser(db(), user.id);
	return rows.map((k) => ({
		id: k.id,
		name: k.name ?? 'Untitled key',
		start: k.start,
		createdAt: String(k.createdAt),
		lastRequest: k.lastRequest ? String(k.lastRequest) : null
	}));
});

/** Create an API key. Returns the plaintext key — shown to the user once. */
export const createApiKey = command(async (): Promise<{ id: string; key: string }> => {
	const user = await requireAuth();
	return createApiKeyForUser(db(), user.id);
});

/** Delete an API key (scoped to the caller's own keys). */
export const deleteApiKey = command(v.string(), async (keyId) => {
	const user = await requireAuth();
	await deleteApiKeyForUser(db(), user.id, keyId);
});
