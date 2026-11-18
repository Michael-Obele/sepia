import type { Db } from "../client.ts";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { apikey, sessions, users } from "../schema.ts";
import { API_KEY_PREFIX } from "../../types.ts";
import { MemoryError } from "../errors.ts";

/**
 * Account helpers shared by the server and the dashboard, so token→user resolution is
 * identical everywhere. `node:crypto` is imported lazily: the barrel is imported by
 * browser-side type stubs, so a top-level import would break that bundle.
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
 * Session token → session row + user, or `undefined` when unknown/expired. The HMAC
 * signature is deliberately NOT verified: the DB row is the authority, which is what
 * makes sessions instantly revocable.
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
 * Slide a session's expiry forward, capped at `createdAt + maxLifetimeMs` so an actively
 * used session still dies eventually — otherwise a leaked token lives forever.
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
 * Hash an API key the way Better Auth stores it: base64url(SHA-256(key)), unpadded and
 * unsalted. Any path that mints keys MUST use this or `getUserByApiKey` never finds them.
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
 * Random key in Better Auth's format, prefixed so it looks identical wherever minted. Rejection
 * sampling discards the short tail of the byte range, avoiding modulo bias.
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
 * Mint an API key, returning the PLAINTEXT once — the table stores only the hash. Lives here,
 * not only behind Better Auth's routes, because the dashboard talks to Neon directly; one
 * implementation means minting and validating cannot drift apart.
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

/**
 * Builder form of the API-key list — NOT async, so a page can compose it into
 * `db.batch([...])` alongside its other reads.
 */
export function apiKeysQuery(db: Db, userId: string) {
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

/** List a user's API keys. Never returns key material. */
export async function listApiKeysForUser(db: Db, userId: string) {
  return apiKeysQuery(db, userId);
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

/** Rename a key. Throws when the key is not the caller's, so a success also proves ownership. */
export async function renameApiKeyForUser(
  db: Db,
  userId: string,
  keyId: string,
  name: string,
) {
  const rows = await db
    .update(apikey)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(apikey.id, keyId), eq(apikey.referenceId, userId)))
    .returning({ id: apikey.id });
  if (rows.length === 0) {
    throw new MemoryError("not_found", `api key '${keyId}' not found`);
  }
}

/**
 * Rotate a key: mint the replacement (same name) BEFORE deleting the old material, so a failed
 * mint never leaves the user with no working key.
 */
export async function regenerateApiKeyForUser(
  db: Db,
  userId: string,
  keyId: string,
) {
  const [row] = await db
    .select({ name: apikey.name })
    .from(apikey)
    .where(and(eq(apikey.id, keyId), eq(apikey.referenceId, userId)));
  if (!row) {
    throw new MemoryError("not_found", `api key '${keyId}' not found`);
  }
  const created = await createApiKeyForUser(db, userId, row.name ?? undefined);
  await deleteApiKeyForUser(db, userId, keyId);
  return created;
}

/**
 * Delete a session by its token (sign-out). Accepts either the signed token
 * (`{sessionId}.{signature}`) or a bare sessionId.
 */
export async function deleteSessionByToken(db: Db, token: string) {
  const sessionId = token.split(".")[0] ?? token;
  await db.delete(sessions).where(eq(sessions.token, sessionId));
}
