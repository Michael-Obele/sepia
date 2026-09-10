import type { Db } from "../client.ts";
import { eq } from "drizzle-orm";
import { oauthClients, oauthTokens } from "../schema.ts";

/**
 * OAuth client helpers, shared by the authorization server and the dashboard.
 *
 * The central idea: an "AI connection" belongs to an APP, not to an OAuth
 * `client_id`. Clients using Dynamic Client Registration (LM Studio, Cursor,
 * any local MCP client) mint a brand-new `client_id` on every authorization,
 * so anything keyed on `client_id` treats each re-authorization as a brand-new
 * connection — inflating the count, duplicating dashboard rows, and eventually
 * locking a user out of an app they had already connected.
 *
 * `getUserByApiKey`-style single implementations matter here too: the quota is
 * enforced by the server but DISPLAYED by the dashboard, and if the two ever
 * count differently users see a limit error that contradicts their usage meter.
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
 * Hostnames this client redirects to, lowercased and sorted.
 *
 * Deliberately WITHOUT the port: a local app re-registers on a different port
 * between runs (LM Studio, for one), and an identity that included the port
 * would treat each run as a brand-new connection.
 */
export function redirectHostnames(uris: string[] | null | undefined): string[] {
  return parseRedirectUris(uris)
    .map((url) => url.hostname.toLowerCase())
    .sort();
}

/**
 * True when a client only ever redirects back to the user's own machine.
 *
 * Such a client is a LOCAL EDITOR (LM Studio, Cursor, …), not a Web AI — and
 * the plan explicitly treats editors as unlimited. Exempting them is safe
 * because a remote service cannot own a loopback redirect.
 *
 * Requires at least one URI and ALL of them loopback, so a client can't claim
 * local status while also redirecting somewhere remote.
 */
export function isLocalClient(uris: string[] | null | undefined): boolean {
  const parsed = parseRedirectUris(uris);
  if (parsed.length === 0) return false;
  return parsed.every((url) => isLoopbackHostname(url.hostname));
}

/**
 * Stable identity of an AI connection: the app, not its current registration.
 *
 * `name` + redirect hostname survives re-registration (and port changes), and
 * unnamed clients still stay distinct from each other because their hosts
 * differ.
 */
export function connectionIdentity(
  name: string | null | undefined,
  uris: string[] | null | undefined,
): string {
  const normalizedName = (name ?? "").trim().toLowerCase();
  const hostname = redirectHostnames(uris)[0] ?? "";
  return `${normalizedName}@${hostname}`;
}

/**
 * The user's existing connection for the same app, if any — matched by stable
 * identity rather than `client_id`, so re-authorization finds it.
 */
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
 * Bind a client to its authorizing user, reusing the row when the same app is
 * already connected.
 *
 * `previous` is the user's existing connection for this app (from
 * `findOwnedConnection`) — passing it in avoids a second lookup and lets the
 * caller make the quota decision first.
 */
export async function bindClientToUser(
  db: Db,
  client: OAuthClientInput,
  userId: string,
  previous?: OAuthClientRow,
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

  // Retire the superseded registration so the app counts once and the
  // dashboard lists one row. Its tokens are revoked with it: the client has
  // already moved on to the credential it just obtained.
  if (previous && previous.clientId !== client.client_id) {
    await db
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthTokens.clientId, previous.clientId));
    await db.delete(oauthClients).where(eq(oauthClients.id, previous.id));
  }
}
