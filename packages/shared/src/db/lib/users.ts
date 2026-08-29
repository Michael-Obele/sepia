import type { Db } from "../client.ts";
import { and, eq, gt } from "drizzle-orm";
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

/** Resolve a Better Auth session token to a user (checks expiry). */
export async function getUserBySessionToken(db: Db, token: string) {
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user;
}

/**
 * Resolve a Better Auth API key to a user. The plugin stores keys as
 * base64url(SHA-256(key)) — hash the incoming key the same way.
 */
export async function getUserByApiKey(db: Db, key: string) {
  // Lazy import — keeps node:crypto out of the browser bundle (see header).
  const { createHash } = await import("node:crypto");
  const hashed = createHash("sha256").update(key).digest("base64url");
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
