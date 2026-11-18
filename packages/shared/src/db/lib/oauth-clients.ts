import type { Db } from "../client.ts";
import { and, eq, isNull } from "drizzle-orm";
import { oauthClients, oauthTokens } from "../schema.ts";

/**
 * An "AI connection" belongs to an APP, not an OAuth `client_id`. DCR clients (LM Studio,
 * Cursor) mint a new client_id per authorization, so keying on it inflates the count,
 * duplicates dashboard rows, and locks users out of an app they already connected. The
 * server enforces the quota and the dashboard displays it — both must count the same way.
 */

export type OAuthClientRow = typeof oauthClients.$inferSelect;

/** Parse redirect URIs, dropping anything unparseable. */
function parseRedirectUris(uris: string[] | null | undefined): URL[] {
  const parsed: URL[] = [];
  for (const uri of uris ?? []) {
    try {
      parsed.push(new URL(uri));
    } catch {
      // A malformed entry shouldn't fail an authorization — just ignore it.
    }
  }
  return parsed;
}

/** `localhost`, any `127.x.x.x`, or IPv6 loopback. */
function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

/**
 * Redirect hostnames, lowercased and sorted. Deliberately WITHOUT the port: a local app
 * re-registers on a different port between runs, and including it would make each run look
 * like a new connection.
 */
export function redirectHostnames(uris: string[] | null | undefined): string[] {
  return parseRedirectUris(uris)
    .map((url) => url.hostname.toLowerCase())
    .sort();
}

/**
 * True when a client only redirects to the user's own machine — a local EDITOR, which the
 * plan leaves unlimited. Safe because a remote service cannot own a loopback redirect.
 * Requires at least one URI and ALL loopback, so it cannot claim local while also going remote.
 */
export function isLocalClient(uris: string[] | null | undefined): boolean {
  const parsed = parseRedirectUris(uris);
  if (parsed.length === 0) return false;
  return parsed.every((url) => isLoopbackHostname(url.hostname));
}

/**
 * Stable identity of an AI connection: `name` + redirect hostname survives re-registration
 * and port changes, and unnamed clients stay distinct because their hosts differ.
 */
export function connectionIdentity(
  name: string | null | undefined,
  uris: string[] | null | undefined,
): string {
  const normalizedName = (name ?? "").trim().toLowerCase();
  const hostname = redirectHostnames(uris)[0] ?? "";
  return `${normalizedName}@${hostname}`;
}

/** True when this client still holds a usable credential (unrevoked, unexpired refresh token). */
export async function hasLiveToken(db: Db, clientId: string): Promise<boolean> {
  const rows = await db
    .select({ expiresAt: oauthTokens.refreshExpiresAt })
    .from(oauthTokens)
    .where(
      and(eq(oauthTokens.clientId, clientId), isNull(oauthTokens.revokedAt)),
    )
    .limit(1);
  const expiresAt = rows[0]?.expiresAt;
  return Boolean(expiresAt) && new Date(expiresAt!).getTime() > Date.now();
}

/** The user's existing connection for the same app, by stable identity rather than client_id. */
export async function findOwnedConnection(
  db: Db,
  ownerId: string,
  name: string | null | undefined,
  uris: string[] | null | undefined,
): Promise<OAuthClientRow | undefined> {
  const target = connectionIdentity(name, uris);
  const rows = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.ownerId, ownerId));
  return rows.find(
    (row) => connectionIdentity(row.name, row.redirectUris) === target,
  );
}

/** The registration row for a given `client_id` (DCR creates these unowned). */
export async function findClientRegistration(db: Db, clientId: string) {
  const rows = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  return rows[0];
}

export interface OAuthClientInput {
  client_id: string;
  client_secret?: string | null;
  client_name?: string | null;
  redirect_uris?: string[] | null;
  token_endpoint_auth_method?: string | null;
}

/**
 * Is `previous` a superseded registration, or a second live account of the same app?
 * App identity (`name@host`) cannot tell: both Grok logins are `Grok@grok.com`. Treating
 * a collision as re-auth revoked a working account's tokens and deleted its row.
 *
 * Only two cases are re-registrations: DEAD (no live token — retiring loses nothing) and
 * LOCAL (loopback; a local editor has one identity, and the quota exempts it). Anything
 * else is presumed a different account: destroying a working connection is unrecoverable,
 * while an extra row is visible, removable, and quota-bounded.
 */
export async function isSupersededRegistration(
  db: Db,
  previous: OAuthClientRow,
  nextClientId: string,
): Promise<boolean> {
  // The same client re-authorizing is never a supersession.
  if (previous.clientId === nextClientId) return false;
  if (isLocalClient(previous.redirectUris)) return true;
  return !(await hasLiveToken(db, previous.clientId));
}

/**
 * Bind a client to its authorizing user, reusing the row when the same app is already
 * connected. `previous` is passed in to avoid a second lookup and let the caller decide the
 * quota first; `superseded` defaults to the local verdict so the two cannot disagree.
 */
export async function bindClientToUser(
  db: Db,
  client: OAuthClientInput,
  userId: string,
  previous?: OAuthClientRow,
  superseded?: boolean,
): Promise<void> {
  const registration = await findClientRegistration(db, client.client_id);

  if (registration) {
    // Adopt the current registration (DCR leaves it unowned).
    if (!registration.ownerId) {
      await db
        .update(oauthClients)
        .set({ ownerId: userId })
        .where(eq(oauthClients.id, registration.id));
    }
  } else {
    // No registration row — a URL-based client (ChatGPT/Grok style).
    await db
      .insert(oauthClients)
      .values({
        clientId: client.client_id,
        clientSecret: client.client_secret ?? null,
        name: client.client_name ?? "MCP client",
        redirectUris: client.redirect_uris ?? [],
        tokenEndpointAuthMethod: client.token_endpoint_auth_method ?? "none",
        ownerId: userId,
      })
      .onConflictDoNothing();
  }

  // Retire the superseded registration so a stale re-registration counts once
  // and the dashboard lists one row. Its tokens are revoked with it: the client
  // has already moved on to the credential it just obtained.
  const retire =
    previous !== undefined &&
    (superseded ??
      (await isSupersededRegistration(db, previous, client.client_id)));

  if (retire && previous!.clientId !== client.client_id) {
    await db
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthTokens.clientId, previous!.clientId));
    await db.delete(oauthClients).where(eq(oauthClients.id, previous!.id));
  }
}
