/**
 * Cross-tenant read probe: does any read path return another owner's rows?
 *
 * Written 2026-11-18 for the reported leak. It does NOT trust code reading —
 * it calls the real functions with owner A's id and asks whether owner B's
 * data comes back. Every probe is read-only.
 *
 * Run: bun run scripts/tenant-isolation-probe.ts
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@sepia/shared";
import { memories, namespaces, users } from "@sepia/shared";
import {
  getBriefing,
  listNamespaces,
  queryMemories,
  search,
  getStats,
} from "@sepia/shared";

const conn = db();

/** The three rows the report named, plus the identifier under test. */
const REPORTED_IDS = [
  "afd74db0-ddab-4516-b2fa-c0c2a92f2134",
  "12c0ce36-bca8-4ff9-ae41-b1bde5cc2111",
  "a49ac456-0eca-4745-ac1d-2ae5d759bfaf",
];
const IDENTIFIER = "emmaono30";

async function main() {
  const owners = await conn
    .select({ id: users.id, email: users.email })
    .from(users)
    .orderBy(users.email);
  console.log(`accounts: ${owners.length}\n`);

  // ── 1. Who actually owns the reported rows? ──────────────────────────────
  console.log("── 1. ownership of the reported rows ──");
  const owned = await conn
    .select({
      id: memories.id,
      owner: users.email,
      ns: namespaces.name,
      type: memories.type,
    })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .innerJoin(users, eq(users.id, namespaces.ownerId))
    .where(inArray(memories.id, REPORTED_IDS));
  for (const row of owned) {
    console.log(`  ${row.id.slice(0, 8)}  owner=${row.owner}  ns=${row.ns}`);
  }
  const ownerOfRows = owned[0]?.owner;
  console.log(`  → all owned by: ${new Set(owned.map((r) => r.owner)).size === 1 ? ownerOfRows : "MIXED"}`);

  // ── 2. Decisive test: can a DIFFERENT owner search them out? ─────────────
  console.log("\n── 2. cross-owner search (the test that decides severity) ──");
  const victim = owners.find((o) => o.email.startsWith(IDENTIFIER));
  const others = owners.filter((o) => o.email !== ownerOfRows);

  for (const probe of others) {
    const hits = await search(conn, String(probe.id), {
      q: IDENTIFIER,
      limit: 25,
    });
    const leaked = hits.filter((h) => REPORTED_IDS.includes(h.id));
    console.log(
      `  ${probe.email.padEnd(40)} hits=${String(hits.length).padStart(2)}  of-reported=${leaked.length}`,
    );
  }
  if (victim) {
    console.log(`  (victim account is ${victim.email})`);
  }

  // ── 3. Same probe against the other read paths ───────────────────────────
  console.log("\n── 3. other read paths, as a non-owner ──");
  const probeId = String(others[0]!.id);
  const probeEmail = others[0]!.email;

  const q = await queryMemories(conn, probeId, { q: IDENTIFIER, limit: 50 });
  console.log(`  queryMemories(q=${IDENTIFIER})       → ${q.length} rows`);

  const ns = await listNamespaces(conn, probeId);
  console.log(`  listNamespaces()                   → ${ns.length} namespaces`);

  const b = await getBriefing(conn, probeId, { detail: "all", max_chars: 200000 });
  const briefLeak = b.memories.filter(
    (m) => REPORTED_IDS.includes(m.id) || m.content.includes(IDENTIFIER),
  );
  console.log(`  getBriefing(detail=all)            → ${b.count} rules, ${briefLeak.length} leaking`);

  const stats = await getStats(conn, probeId);
  console.log(`  getStats()                         → ${stats.memories ?? "?"} memories counted`);

  // ── 4. Corpus scan: whose identifiers sit in whose rows? ─────────────────
  console.log("\n── 4. corpus scan — every account's email inside foreign rows ──");
  let found = 0;
  for (const suspect of owners) {
    if (!suspect.email || suspect.email.includes("example.com")) continue;
    const local = suspect.email.split("@")[0]!.toLowerCase();
    if (local.length < 6) continue;
    const rows = await conn.execute(sql`
      SELECT u.email AS row_owner, count(*)::int AS n
      FROM memories m
      JOIN namespaces n ON n.id = m.namespace_id
      JOIN users u ON u.id = n.owner_id
      WHERE m.content ILIKE ${"%" + local + "%"}
        AND u.email <> ${suspect.email}
      GROUP BY u.email
    `);
    const hits = rows.rows as unknown as { row_owner: string; n: number }[];
    if (hits.length) {
      found += hits.reduce((s, h) => s + h.n, 0);
      console.log(`  ${suspect.email} appears in rows owned by:`);
      for (const h of hits) console.log(`      ${h.row_owner}  × ${h.n}`);
    }
  }
  if (!found) console.log("  none — no account's email appears in another's rows");

  // ── 5. Is any reported row reachable by id without an owner check? ───────
  console.log("\n── 5. getMemory by id as a non-owner ──");
  const { getMemory } = await import("@sepia/shared");
  for (const id of REPORTED_IDS) {
    try {
      const row = await getMemory(conn, probeId, id);
      console.log(`  ${id.slice(0, 8)} → RETURNED (owner check missing!)`);
    } catch {
      console.log(`  ${id.slice(0, 8)} → refused (correct)`);
    }
  }
  console.log(`\nprobe account: ${probeEmail}`);
}

await main();
