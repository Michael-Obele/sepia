import type { Db } from "../client.ts";
import { and, eq, isNull } from "drizzle-orm";
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
 * True when this client still holds a usable credential.
 *
 * A connection with no non-revoked, unexpired refresh token can never be used
 * again, so retiring it costs the user nothing. This is the discriminator that
 * tells a stale re-registration from a second, live account of the same app.
 */
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
 * Whether `previous` is a SUPERSEDED registration that may be retired, rather
 * than a second live account of the same app that must be left alone.
 *
 * App identity (`name@host`) cannot tell one ACCOUNT of an app from another:
 * both Grok logins are `Grok@grok.com`. Treating every same-app collision as a
 * re-authorization meant binding a second Grok account revoked the first one's
 * tokens and deleted its row — a destructive, irreversible loss of a working
 * connection, with nothing left in the dashboard to show it happened.
 *
 * So a collision is only a re-registration when we can show the old row is not
 * doing any work:
 *
 *   - DEAD (no live token). It can never authorize again, so retiring it loses
 *     nothing. This is the stale-registration case that must not leak quota.
 *   - LOCAL (loopback-only redirect). A local editor has exactly one identity —
 *     one LM Studio, one machine — so two loopback rows for the same app are
 *     re-registrations by definition, and the quota exempts them anyway. This
 *     is the case commit 2be9c32 was written for, unchanged.
 *
 * Anything else is presumed to be a DIFFERENT account, because the asymmetry is
 * lopsided: destroying a working connection is unrecoverable, while an extra row
 * the user did not ask for is visible, removable, and bounded by the quota.
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
 * Bind a client to its authorizing user, reusing the row when the same app is
 * already connected.
 *
 * `previous` is the user's existing connection for this app (from
 * `findOwnedConnection`) — passing it in avoids a second lookup and lets the
 * caller make the quota decision first. `superseded` is that caller's
 * `isSupersededRegistration` verdict; when omitted it is computed here so the
 * two can never disagree.
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
