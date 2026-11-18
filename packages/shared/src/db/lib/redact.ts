/**
 * Cross-account identifier redaction on the write path. A migration report saved as
 * ordinary memories carried a second user's email into searchable prose — not a tenant
 * breach, but a leak, and the write path said nothing.
 *
 * SCOPE IS THE DESIGN: only an address belonging to a REGISTERED ACCOUNT other than the
 * writer is foreign. A colleague, vendor or quoted support address is ordinary content —
 * masking those would break the thing people actually store. Masks and reports, never
 * refuses (no blocking rails). One regex pass and zero round trips when there is no email.
 */
import type { Db } from "../client.ts";
import { sql } from "drizzle-orm";
import { users } from "../schema.ts";
import { textArray } from "./util.ts";

/** What a foreign account's address is replaced with. Deliberately generic. */
export const FOREIGN_ACCOUNT_MASK = "[redacted:other-account]";

/**
 * Deliberately conservative: matches the same shape the auth layer accepts.
 * `global` because we replace every occurrence, and no `u` flag so a long
 * non-ASCII run cannot make the scan quadratic.
 */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Unique, lowercased addresses present in `text`. */
export function extractEmails(text: string): string[] {
  const found = text.match(EMAIL_RE) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))];
}

/**
 * Which of `texts`' addresses belong to a DIFFERENT registered account.
 *
 * The writer's own address is excluded: a user storing their own login, or a
 * report that legitimately names the account it was produced for, must not be
 * mangled.
 */
export async function findForeignAccountEmails(
  db: Db,
  ownerId: string,
  texts: readonly string[],
): Promise<string[]> {
  const candidates = [
    ...new Set(texts.flatMap((text) => (text ? extractEmails(text) : []))),
  ];
  if (candidates.length === 0) return [];
  const rows = await db
    .select({ email: sql<string>`lower(${users.email})` })
    .from(users)
    .where(
      sql`lower(${users.email}) = ANY(${textArray(candidates)}) AND ${users.id} <> ${ownerId}`,
    );
  return rows.map((r) => String(r.email));
}

/**
 * Mask every occurrence of `emails` in `text`. Whole-token replacement, so
 * `emma@x.com` inside `notemma@x.com.ng` is not a partial hit — the regex would
 * have extracted the longer address as its own candidate.
 */
export function applyAccountRedactions(
  text: string,
  emails: readonly string[],
): string {
  if (!text || emails.length === 0) return text;
  let out = text;
  for (const email of emails) {
    // Case-insensitive, literal — the address may appear capitalised.
    out = out.replace(
      new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      FOREIGN_ACCOUNT_MASK,
    );
  }
  return out;
}

export interface Redacted {
  texts: string[];
  /** How many distinct foreign accounts were masked. Zero for the common case. */
  redacted: number;
}

/** Batch form for a whole write: one lookup, every field. An ingest carries a dozen fields. */
export async function redactForeignAccounts(
  db: Db,
  ownerId: string,
  texts: readonly string[],
): Promise<Redacted> {
  const emails = await findForeignAccountEmails(db, ownerId, texts);
  if (emails.length === 0) return { texts: [...texts], redacted: 0 };
  return {
    texts: texts.map((text) => applyAccountRedactions(text, emails)),
    redacted: emails.length,
  };
}
