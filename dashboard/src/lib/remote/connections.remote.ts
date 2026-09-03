import { query, command } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';
import { oauthClients, oauthTokens } from '@sepia/shared';
import { eq, and, isNull, gt, desc } from 'drizzle-orm';

export interface ConnectionRow {
	id: string;
	clientId: string;
	name: string;
	redirectUris: string[];
	createdAt: string;
	/** null if never used / no tokens */
	lastUsedAt: string | null;
	/** true if at least one non-revoked refresh token is still valid */
	active: boolean;
}

function hostFromUris(uris: string[]): string | null {
	for (const u of uris) {
		try {
			return new URL(u).hostname.toLowerCase();
		} catch {
			// ignore
		}
	}
	return null;
}

/** List Web AI connections (OAuth clients) for the current user. */
export const listConnections = query(v.string(), async (token): Promise<ConnectionRow[]> => {
	const user = await requireAuth(token);
	const clients = await db()
		.select()
		.from(oauthClients)
		.where(eq(oauthClients.ownerId, user.id))
		.orderBy(desc(oauthClients.createdAt));

	if (clients.length === 0) return [];

	// Batch fetch latest token per client to compute lastUsedAt / active
	const now = new Date();
	const rows: ConnectionRow[] = [];
	for (const c of clients) {
		const tokens = await db()
			.select()
			.from(oauthTokens)
			.where(eq(oauthTokens.clientId, c.clientId))
			.orderBy(desc(oauthTokens.refreshExpiresAt));

		let lastUsedAt: string | null = null;
		let active = false;
		if (tokens.length > 0) {
			// lastUsedAt = most recent token's refreshExpiresAt minus TTL is approx last issue time;
			// better: use max of expiresAt / created ordering. We use the newest token's expiresAt as proxy.
			// Prefer the newest non-revoked token's expiry as last activity.
			const newest = tokens[0];
			// Use the newest token's expiresAt as last activity marker (issue time + 1h)
			// Fallback to createdAt if no tokens
			lastUsedAt = newest.expiresAt ? String(newest.expiresAt) : null;
			active = tokens.some((t) => !t.revokedAt && new Date(t.refreshExpiresAt) > now);
		}
		rows.push({
			id: c.id,
			clientId: c.clientId,
			name: c.name,
			redirectUris: c.redirectUris as string[],
			createdAt: String(c.createdAt),
			lastUsedAt,
			active
		});
	}
	return rows;
});

/** Disconnect (revoke + delete) a Web AI connection. Only the owner can do this. */
export const disconnectConnection = command(
	v.tuple([v.string(), v.string()]),
	async ([token, clientId]): Promise<{ ok: true }> => {
		const user = await requireAuth(token);
		const rows = await db()
			.select()
			.from(oauthClients)
			.where(and(eq(oauthClients.clientId, clientId), eq(oauthClients.ownerId, user.id)));
		if (rows.length === 0) throw new Error('Connection not found');

		// Revoke all tokens for this client
		await db()
			.update(oauthTokens)
			.set({ revokedAt: new Date() })
			.where(eq(oauthTokens.clientId, clientId));

		// Delete the client row — frees the quota slot
		await db().delete(oauthClients).where(eq(oauthClients.clientId, clientId));

		return { ok: true };
	}
);
