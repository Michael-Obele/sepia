/**
 * Sweeps the corpus for one account's identifier sitting inside ANOTHER
 * account's rows, and masks it.
 *
 * WHY. The write-path guard (`db/lib/redact.ts`) only protects memories written
 * from now on. Rows written before it existed still carry the identifier, and
 * "we fixed the code" is not a fix for data already stored.
 *
 * DRY RUN BY DEFAULT — prints a table and writes nothing. `--apply` masks, and
 * only masks: no row is deleted, no content beyond the address is touched, so
 * the engineering finding survives and the identifier does not.
 *
 * SCOPE. Only addresses belonging to a REGISTERED ACCOUNT (`users` row) other
 * than the row's own owner. A contact, a vendor, a quoted support address — none
 * of those are anyone's account here, so they are left exactly as written.
 *
 * Run:
 *   bun run scripts/redact-existing-leaks.ts            # report only
 *   bun run scripts/redact-existing-leaks.ts --apply    # mask
 */
import { sql } from "drizzle-orm";
import { db } from "@sepia/shared";
import { FOREIGN_ACCOUNT_MASK } from "@sepia/shared";

const APPLY = process.argv.includes("--apply");

interface Hit {
  id: string;
  kind: "memory" | "entity";
  rowOwner: string;
  namespace: string;
  foreignOwner: string;
  email: string;
}

const conn = db();

/** Every real account, by lowercased email. Test fixtures are skipped: they
 *  are not people, and masking a seeded fixture address would hide a real
 *  problem behind noise. */
async function accountEmails(): Promise<Map<string, { id: string; email: string }>> {
  const rows = await conn.execute(sql`
    SELECT id, lower(email) AS email FROM users
    WHERE email NOT LIKE '%@sepia.test'
      AND email NOT LIKE '%@example.com'
      AND email NOT LIKE '%@svelte-apps.me'
      AND email NOT LIKE '%@sepia.local'
  `);
  const map = new Map<string, { id: string; email: string }>();
  for (const r of rows.rows as unknown as { id: string; email: string }[]) {
    map.set(r.email, r);
  }
  return map;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

async function scan(): Promise<Hit[]> {
  const accounts = await accountEmails();
  const hits: Hit[] = [];

  // ── memories ────────────────────────────────────────────────────────────
  const mem = await conn.execute(sql`
    SELECT m.id, m.content, u.email AS row_owner, n.name AS namespace
    FROM memories m
    JOIN namespaces n ON n.id = m.namespace_id
    JOIN users u ON u.id = n.owner_id
  `);
  for (const row of mem.rows as unknown as {
    id: string;
    content: string;
    row_owner: string;
    namespace: string;
  }[]) {
    const seen = new Set<string>();
    for (const found of row.content.match(EMAIL_RE) ?? []) {
      const email = found.toLowerCase();
      const account = accounts.get(email);
      if (!account || account.email === row.row_owner.toLowerCase()) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      hits.push({
        id: row.id,
        kind: "memory",
        rowOwner: row.row_owner,
        namespace: row.namespace,
        foreignOwner: account.email,
        email,
      });
    }
  }

  // ── entities (summary is searchable prose too) ──────────────────────────
  const ent = await conn.execute(sql`
    SELECT e.id, COALESCE(e.summary, '') AS summary, u.email AS row_owner, n.name AS namespace
    FROM entities e
    JOIN namespaces n ON n.id = e.namespace_id
    JOIN users u ON u.id = n.owner_id
  `);
  for (const row of ent.rows as unknown as {
    id: string;
    summary: string;
    row_owner: string;
    namespace: string;
  }[]) {
    const seen = new Set<string>();
    for (const found of row.summary.match(EMAIL_RE) ?? []) {
      const email = found.toLowerCase();
      const account = accounts.get(email);
      if (!account || account.email === row.row_owner.toLowerCase()) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      hits.push({
        id: row.id,
        kind: "entity",
        rowOwner: row.row_owner,
        namespace: row.namespace,
        foreignOwner: account.email,
        email,
      });
    }
  }

  return hits;
}

async function main() {
  const hits = await scan();

  if (hits.length === 0) {
    console.log("clean — no account's identifier appears in another account's rows");
    return;
  }

  console.log(`rows carrying another ACCOUNT's address: ${hits.length}\n`);
  const table = hits.map((h) => ({
    kind: h.kind,
    id: h.id.slice(0, 8),
    "row owner": h.rowOwner,
    namespace: h.namespace,
    "address belongs to": h.foreignOwner,
  }));
  console.table(table);

  if (!APPLY) {
    console.log(
      "DRY RUN — nothing written. Re-run with --apply to mask the addresses in place.",
    );
    return;
  }

  // Mask per row, using only the addresses that row actually carries.
  const byId = new Map<string, Hit[]>();
  for (const hit of hits) {
    byId.set(`${hit.kind}:${hit.id}`, [
      ...(byId.get(`${hit.kind}:${hit.id}`) ?? []),
      hit,
    ]);
  }

  let memoriesTouched = 0;
  let entitiesTouched = 0;
  for (const [key, group] of byId) {
    const [kind, id] = key.split(":") as ["memory" | "entity", string];
    if (kind === "memory") {
      const [row] = (
        await conn.execute(sql`SELECT content FROM memories WHERE id = ${id}`)
      ).rows as unknown as { content: string }[];
      if (!row) continue;
      let content = row.content;
      for (const hit of group) {
        content = content.replace(
          new RegExp(hit.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
          FOREIGN_ACCOUNT_MASK,
        );
      }
      await conn.execute(
        sql`UPDATE memories SET content = ${content}, updated_at = now() WHERE id = ${id}`,
      );
      memoriesTouched += 1;
    } else {
      const [row] = (
        await conn.execute(
          sql`SELECT COALESCE(summary, '') AS summary FROM entities WHERE id = ${id}`,
        )
      ).rows as unknown as { summary: string }[];
      if (!row) continue;
      let summary = row.summary;
      for (const hit of group) {
        summary = summary.replace(
          new RegExp(hit.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
          FOREIGN_ACCOUNT_MASK,
        );
      }
      await conn.execute(
        sql`UPDATE entities SET summary = ${summary}, updated_at = now() WHERE id = ${id}`,
      );
      entitiesTouched += 1;
    }
  }

  console.log(
    `\nAPPLIED. memories masked: ${memoriesTouched}, entities masked: ${entitiesTouched}.`,
  );
  console.log("Nothing deleted. Re-scan to confirm.");
}

await main();
