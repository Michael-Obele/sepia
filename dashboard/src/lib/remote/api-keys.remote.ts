import { query, form, command } from '$app/server';
import * as v from 'valibot';
import {
	createApiKeyForUser,
	deleteApiKeyForUser,
	listApiKeysForUser,
	regenerateApiKeyForUser,
	renameApiKeyForUser
} from '@sepia/shared';
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

/**
 * Create or rename an API key, as a form — the dialog's button is a submit
 * button. `id` present → rename; absent → mint a new key (the same
 * create-or-update shape `saveMemory` uses).
 *
 * The name is REQUIRED here even though the `apikey.name` column stays
 * nullable: older rows (and keys minted by the Better Auth plugin) keep
 * reading, while every key created from now on gets a label the user chose.
 * Returns the plaintext key on create (shown once) — `undefined` on rename.
 */
export const saveApiKey = form(
	v.object({
		id: v.optional(v.string(), ''),
		name: v.pipe(
			v.string(),
			v.trim(),
			v.minLength(1, 'Give the key a name so you know what it is for'),
			v.maxLength(64, 'Keep the name under 64 characters')
		)
	}),
	async ({ id, name }) => {
		const user = await requireAuth();
		if (id) {
			await renameApiKeyForUser(db(), user.id, id, name);
			return;
		}
		return createApiKeyForUser(db(), user.id, name);
	}
);

/**
 * Rotate a key — new secret, same name (a command: no form inputs, it is a
 * bare button on the connect page).
 */
export const regenerateApiKey = command(v.string(), async (keyId) => {
	const user = await requireAuth();
	return regenerateApiKeyForUser(db(), user.id, keyId);
});

/** Delete an API key (scoped to the caller's own keys). */
export const deleteApiKey = command(v.string(), async (keyId) => {
	const user = await requireAuth();
	await deleteApiKeyForUser(db(), user.id, keyId);
});
