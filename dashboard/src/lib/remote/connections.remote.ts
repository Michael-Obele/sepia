import { query, command } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';
import { apiKeysQuery, isLocalClient, oauthClients, oauthTokens, type Db } from '@sepia/shared';
import { eq, and, desc } from 'drizzle-orm';

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
	/**
	 * A loopback-only client (LM Studio, Cursor, …) — a local editor rather than
	 * a Web AI. Exempt from the plan's connection limit, matching
	 * `countAiConnections`, which excludes these from the usage meter too.
	 */
	local: boolean;
}

/** Builder: every OAuth client this owner has registered. */
function clientsQuery(sql: Db, ownerId: string) {
	return sql
		.select()
		.from(oauthClients)
		.where(eq(oauthClients.ownerId, ownerId))
		.orderBy(desc(oauthClients.createdAt));
}

/**
 * Builder: every token belonging to this owner's clients, in one read.
 *
 * Scoped through a JOIN rather than a list of client ids so it does NOT depend on
 * `clientsQuery` — that is what lets both go in the same `db.batch` (one HTTP
 * round trip). Only the four columns the activity calculation needs.
 */
function tokensForOwnerQuery(sql: Db, ownerId: string) {
	return sql
		.select({
			clientId: oauthTokens.clientId,
			expiresAt: oauthTokens.expiresAt,
			refreshExpiresAt: oauthTokens.refreshExpiresAt,
			revokedAt: oauthTokens.revokedAt
		})
		.from(oauthTokens)
		.innerJoin(oauthClients, eq(oauthClients.clientId, oauthTokens.clientId))
		.where(eq(oauthClients.ownerId, ownerId))
		.orderBy(desc(oauthTokens.refreshExpiresAt));
}

/** Shape of one row from `tokensForOwnerQuery`. */
type TokenRow = Awaited<ReturnType<typeof tokensForOwnerQuery>>[number];

/**
 * Join clients to their tokens in memory — replacing the per-client query loop
 * this used to run. Tokens arrive newest-first (refresh expiry desc), so the
 * first token for a client is the newest, exactly as before.
 */
function buildConnections(
	clients: Awaited<ReturnType<typeof clientsQuery>>,
	tokens: TokenRow[]
): ConnectionRow[] {
	const now = new Date();
	const byClient = new Map<string, TokenRow[]>();
	for (const t of tokens) {
		const list = byClient.get(t.clientId);
		if (list) list.push(t);
		else byClient.set(t.clientId, [t]);
	}

	return clients.map((c) => {
		const list = byClient.get(c.clientId) ?? [];
		// Newest token's expiry is the closest thing we store to "last activity".
		const newest = list[0];
		return {
			id: c.id,
			clientId: c.clientId,
			name: c.name,
			redirectUris: c.redirectUris as string[],
			createdAt: String(c.createdAt),
			lastUsedAt: newest?.expiresAt ? String(newest.expiresAt) : null,
			active: list.some((t) => !t.revokedAt && new Date(t.refreshExpiresAt) > now),
			local: isLocalClient(c.redirectUris as string[])
		};
	});
}

/**
 * List Web AI connections (OAuth clients) for the current user.
 *
 * ONE Neon HTTP round trip. This used to run a token query INSIDE a loop over
 * the user's clients — an N+1 that cost an extra ~300 ms round trip per
 * connection on every visit to `/app/connect`.
 */
export const listConnections = query(async (): Promise<ConnectionRow[]> => {
	const user = await requireAuth();
	const sql = db();
	const [clients, tokens] = await sql.batch([
		clientsQuery(sql, user.id),
		tokensForOwnerQuery(sql, user.id)
	]);
	return buildConnections(clients, tokens);
});

/** One API key as the connect page renders it. */
export interface ConnectApiKey {
	id: string;
	name: string;
	start: string | null;
	createdAt: string;
	lastRequest: string | null;
}

export interface ConnectPage {
	apiKeys: ConnectApiKey[];
	connections: ConnectionRow[];
}

/**
 * Everything `/app/connect` renders on its first paint, in ONE Neon HTTP round
 * trip: the API keys, the OAuth clients and their tokens.
 */
export const getConnectPage = query(async (): Promise<ConnectPage> => {
	const user = await requireAuth();
	const sql = db();
	const [keys, clients, tokens] = await sql.batch([
		apiKeysQuery(sql, user.id),
		clientsQuery(sql, user.id),
		tokensForOwnerQuery(sql, user.id)
	]);
	return {
		apiKeys: keys.map((k) => ({
			id: String(k.id),
			name: k.name ?? 'Untitled key',
			start: k.start,
			createdAt: String(k.createdAt),
			lastRequest: k.lastRequest ? String(k.lastRequest) : null
		})),
		connections: buildConnections(clients, tokens)
	};
});

/** Disconnect (revoke + delete) a Web AI connection. Only the owner can do this. */
export const disconnectConnection = command(v.string(), async (clientId): Promise<{ ok: true }> => {
	const user = await requireAuth();
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
});
