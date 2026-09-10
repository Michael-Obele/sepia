import type { Db } from "../client.ts";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { apikey, sessions, users } from "../schema.ts";

/**
 * Account helpers shared by the MCP server and the dashboard. Both resolve
 * a bearer token to a user the same way (session token or API key), so the
 * scoping is identical everywhere.
 *
 * NOTE: `node:crypto` is imported lazily inside getUserByApiKey — this
 * module is re-exported through the shared barrel, which the dashboard's
 * remote-function CLIENT stubs also import (for types). A top-level
 * node:crypto import would break the browser bundle.
 */

export type UserRow = typeof users.$inferSelect;

export async function getUserById(db: Db, id: string) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function getUserByEmail(db: Db, email: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return rows[0];
}

/**
 * Resolve a Better Auth session token to its session row + user (checks
 * expiry). Returns `undefined` for unknown or expired sessions.
 *
 * NOTE: the token's HMAC signature is intentionally NOT verified — the DB
 * row is the authority (a unique, high-entropy `sessions.token`), which makes
 * sessions instantly revocable. Verifying the signature would only matter if
 * we were validating statelessly without a database round-trip.
 */
export async function getSessionWithUser(db: Db, token: string) {
  // Better Auth session tokens are `{sessionId}.{signature}` — the DB
  // `sessions.token` column stores only the sessionId (the part before the
  // dot); the signature is validated statelessly by Better Auth itself.
  // Accept both the full signed token (from the sign-in `set-auth-token`
  // response header / bearer plugin) and the bare sessionId (the legacy
  // sign-in body `token`), so callers can pass either form.
  const sessionId = token.split(".")[0] ?? token;
  const rows = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(eq(sessions.token, sessionId), gt(sessions.expiresAt, new Date())),
    )
    .limit(1);
  return rows[0];
}

/**
 * Slide a session's expiry forward from "now" (activity-based renewal).
 *
 * The new expiry is capped at `createdAt + maxLifetimeMs`, so an actively-used
 * session still dies eventually — otherwise a leaked token would live forever.
 * Callers decide *when* to slide (see `SESSION_REFRESH_INTERVAL_MS` in the
 * dashboard) so this stays a bounded number of writes.
 */
export async function slideSession(
  db: Db,
  sessionId: string,
  createdAt: Date,
  ttlMs: number,
  maxLifetimeMs: number,
) {
  const now = Date.now();
  const expiresAt = new Date(
    Math.min(now + ttlMs, createdAt.getTime() + maxLifetimeMs),
  );
  await db
    .update(sessions)
    .set({ expiresAt, updatedAt: new Date(now) })
    .where(eq(sessions.token, sessionId));
}

/**
 * Delete every session for a user except the one currently in use.
 * Backs the "sign out other sessions" control in the account page.
 */
export async function deleteOtherSessions(
  db: Db,
  userId: string,
  keepSessionId: string,
) {
  return db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.token, keepSessionId)));
}

/**
 * Hash an API key the way Better Auth stores it: base64url(SHA-256(key)),
 * unpadded and unsalted. Any implementation that mints keys MUST use this,
 * or `getUserByApiKey` will never find them.
 *
 * Lazy `node:crypto` import — keeps it out of the browser bundle (see header).
 */
async function hashApiKey(key: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(key).digest("base64url");
}

/**
 * Resolve a Better Auth API key to a user. Stored keys are hashes, so hash the
 * incoming key the same way before comparing.
 */
export async function getUserByApiKey(db: Db, key: string) {
  const hashed = await hashApiKey(key);
  const rows = await db
    .select({ user: users, key: apikey })
    .from(apikey)
    .innerJoin(users, eq(apikey.referenceId, users.id))
    .where(and(eq(apikey.key, hashed), eq(apikey.enabled, true)))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  if (row.key.expiresAt && row.key.expiresAt.getTime() < Date.now()) {
    return undefined;
  }
  return row.user;
}

/**
 * The key's leading identity string — what makes a sepia credential
 * recognisable on sight, in a log, or to a secret scanner (`sepia_Ab3xk…`).
 *
 * Same convention as `ghp_` (GitHub), `sk_live_` (Stripe) and `sk-ant-`
 * (Anthropic): a fixed, greppable brand prefix followed by high-entropy
 * randomness. Exported so the auth server can pass it as the plugin's
 * `defaultPrefix` — keys minted by either path must be indistinguishable.
 */
export const API_KEY_PREFIX = "sepia_";

/** Better Auth's key generator uses letters only, 64 characters. */
const API_KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const API_KEY_LENGTH = 64;

/**
 * How much of the key is safe to store and display as a fingerprint —
 * `sepia_` plus 4 random characters. Enough to tell two keys apart in a list,
 * far too little to help an attacker (60 random characters remain).
 */
export const API_KEY_START_LENGTH = 10;

/**
 * Generate a random API key, matching Better Auth's format (letters, 64 chars)
 * and prepending `API_KEY_PREFIX` so keys look identical wherever they are
 * minted. Rejection sampling discards the short tail of the byte range,
 * avoiding the modulo bias a plain `% alphabet.length` would introduce.
 */
function generateApiKey(): string {
  const limit = 256 - (256 % API_KEY_ALPHABET.length);
  const buffer = new Uint8Array(API_KEY_LENGTH);
  const out: string[] = [];
  while (out.length < API_KEY_LENGTH) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= limit) continue;
      const char = API_KEY_ALPHABET[byte % API_KEY_ALPHABET.length];
      if (char) out.push(char);
      if (out.length === API_KEY_LENGTH) break;
    }
  }
  return `${API_KEY_PREFIX}${out.join("")}`;
}

/**
 * Mint an API key for a user. Returns the PLAINTEXT key — the only moment it
 * exists in readable form; the table stores just the hash.
 *
 * This lives in the shared data layer rather than only behind Better Auth's
 * `/api/auth/api-key/*` routes because the dashboard talks to Neon directly.
 * One implementation means keys minted by the dashboard and keys validated by
 * the MCP server can never drift apart.
 */
export async function createApiKeyForUser(
  db: Db,
  userId: string,
  name?: string,
) {
  const key = generateApiKey();
  const [row] = await db
    .insert(apikey)
    .values({
      id: crypto.randomUUID(),
      configId: "default",
      name: name ?? `sepia-${new Date().toISOString().slice(0, 10)}`,
      prefix: API_KEY_PREFIX,
      // `start` is the non-secret fingerprint shown in UIs (`sepia_Ab3x`).
      start: key.slice(0, API_KEY_START_LENGTH),
      key: await hashApiKey(key),
      referenceId: userId,
      enabled: true,
      rateLimitEnabled: true,
      rateLimitTimeWindow: 24 * 60 * 60 * 1000,
      rateLimitMax: 10,
      requestCount: 0,
    })
    .returning({ id: apikey.id });
  if (!row) throw new Error("Failed to create API key");
  return { id: row.id, key };
}

/** List a user's API keys. Never returns key material. */
export async function listApiKeysForUser(db: Db, userId: string) {
  return db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      createdAt: apikey.createdAt,
      lastRequest: apikey.lastRequest,
    })
    .from(apikey)
    .where(eq(apikey.referenceId, userId))
    .orderBy(desc(apikey.createdAt));
}

/**
 * Delete one of a user's API keys. Scoped by `referenceId` so a caller cannot
 * revoke another account's key by passing its id.
 */
export async function deleteApiKeyForUser(
  db: Db,
  userId: string,
  keyId: string,
) {
  await db
    .delete(apikey)
    .where(and(eq(apikey.id, keyId), eq(apikey.referenceId, userId)));
}

/**
 * Delete a session by its token (sign-out). Accepts either the signed token
 * (`{sessionId}.{signature}`) or a bare sessionId.
 */
export async function deleteSessionByToken(db: Db, token: string) {
  const sessionId = token.split(".")[0] ?? token;
  await db.delete(sessions).where(eq(sessions.token, sessionId));
}
